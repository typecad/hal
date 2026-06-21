import type { Diagnostic } from '../types.js';
import type { BoardConstants } from './board-resolver.js';
import type { PeripheralUsage } from './peripheral-usage.js';
import { findBoardPinByName, formatPinReference } from './board-pin-utils.js';

interface PwmTimerPin {
  pinNumber: number;
  canonicalName: string;
  aliases: string[];
  timerId: string;
}

function extractTimerId(role: string | undefined, timerField: string | undefined): string | undefined {
  // Prefer explicit timer field from board definition
  if (timerField) {
    return timerField;
  }

  if (!role) {
    return undefined;
  }

  // Fall back to parsing AVR OC register naming convention
  const match = role.match(/^OC(\d+)[A-Z]?$/i);
  return match ? `timer${match[1]}` : undefined;
}

function getPwmTimerPins(boardConstants: BoardConstants | undefined): PwmTimerPin[] {
  if (!boardConstants) {
    return [];
  }

  const pinsByIndex = new Map<string, PwmTimerPin>();

  for (const [key, value] of boardConstants) {
    const nameMatch = key.match(/^pins\.all\.(\d+)\.name$/);
    if (nameMatch && typeof value === 'string') {
      const pinIndex = nameMatch[1];
      const numberValue = boardConstants.get(`pins.all.${pinIndex}.number`);
      const aliasesValue = boardConstants.get(`pins.all.${pinIndex}.aliases`);
      const aliases = typeof aliasesValue === 'string' && aliasesValue.length > 0
        ? aliasesValue.split(',').map(entry => entry.trim()).filter(Boolean)
        : [];

      pinsByIndex.set(pinIndex, {
        pinNumber: typeof numberValue === 'number' ? numberValue : Number(pinIndex),
        canonicalName: value,
        aliases,
        timerId: '',
      });
    }
  }

  for (const [key, value] of boardConstants) {
    const typeMatch = key.match(/^pins\.all\.(\d+)\.functions\.\d+\.type$/);
    if (!typeMatch || value !== 'pwm') {
      continue;
    }

    const pinIndex = typeMatch[1];
    const roleKey = key.replace(/\.type$/, '.role');
    const timerKey = key.replace(/\.type$/, '.timer');
    const timerId = extractTimerId(
      boardConstants.get(roleKey) as string | undefined,
      boardConstants.get(timerKey) as string | undefined,
    );
    if (!timerId) {
      continue;
    }

    const pin = pinsByIndex.get(pinIndex);
    if (pin) {
      pin.timerId = timerId;
    }
  }

  return Array.from(pinsByIndex.values()).filter(pin => pin.timerId.length > 0);
}

export function validatePWMTimerSharing(
  usage: PeripheralUsage,
  boardConstants: BoardConstants | undefined,
): Diagnostic[] {
  if (usage.pwmPinsUsed.size < 2 || !boardConstants) {
    return [];
  }

  const boardName = boardConstants.get('name');
  const boardLabel = typeof boardName === 'string' && boardName.length > 0
    ? ` on ${boardName}`
    : '';
  const pins = getPwmTimerPins(boardConstants);
  const pinsByTimer = new Map<string, PwmTimerPin[]>();

  for (const pin of pins) {
    if (!usage.pwmPinsUsed.has(pin.pinNumber)) {
      continue;
    }

    const group = pinsByTimer.get(pin.timerId) ?? [];
    group.push(pin);
    pinsByTimer.set(pin.timerId, group);
  }

  const diagnostics: Diagnostic[] = [];

  for (const [timerId, timerPins] of pinsByTimer) {
    if (timerPins.length < 2) {
      continue;
    }

    const references = timerPins
      .sort((left, right) => left.pinNumber - right.pinNumber)
      .map((pin) => {
        const usedNames = [pin.canonicalName, ...pin.aliases].filter(name => usage.pinsUsed.has(name));
        const preferredName = usedNames[0] ?? pin.canonicalName;
        return formatPinReference(preferredName, findBoardPinByName(pin.canonicalName, boardConstants));
      });

    diagnostics.push({
      severity: 'info',
      code: 'pwm-timer-sharing',
      source: 'pwm-timer-sharing',
      message: `${references.join(', ')} share ${timerId}${boardLabel}. Duty cycle can differ per pin, but timer-wide PWM settings are shared across that group. Prefer pins on different timer groups if you need independent PWM timing behavior.`,
    });
  }

  return diagnostics;
}