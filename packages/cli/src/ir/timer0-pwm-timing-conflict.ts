import type { Diagnostic } from '../types';
import type { BoardConstants } from './board-resolver';
import type { PeripheralUsage } from './peripheral-usage';
import { findBoardPinByName, formatPinReference } from './board-pin-utils';

interface TimerPwmPin {
  pinNumber: number;
  canonicalName: string;
  aliases: string[];
}

function getTimer0PwmPins(boardConstants: BoardConstants | undefined): TimerPwmPin[] {
  if (!boardConstants) {
    return [];
  }

  const pinsByIndex = new Map<string, TimerPwmPin>();

  for (const [key, value] of boardConstants) {
    const match = key.match(/^pins\.all\.(\d+)\.name$/);
    if (!match || typeof value !== 'string') {
      continue;
    }

    const pinIndex = match[1];
    const numberValue = boardConstants.get(`pins.all.${pinIndex}.number`);
    const aliasesValue = boardConstants.get(`pins.all.${pinIndex}.aliases`);
    const aliases = typeof aliasesValue === 'string' && aliasesValue.length > 0
      ? aliasesValue.split(',').map(entry => entry.trim()).filter(Boolean)
      : [];

    pinsByIndex.set(pinIndex, {
      pinNumber: typeof numberValue === 'number' ? numberValue : Number(pinIndex),
      canonicalName: value,
      aliases,
    });
  }

  const timer0Pins: TimerPwmPin[] = [];

  for (const [key, value] of boardConstants) {
    const match = key.match(/^pins\.all\.(\d+)\.functions\.\d+\.role$/);
    if (!match || typeof value !== 'string' || !/^OC0[A-Z]?$/i.test(value)) {
      continue;
    }

    const pin = pinsByIndex.get(match[1]);
    if (pin) {
      timer0Pins.push(pin);
    }
  }

  return timer0Pins;
}

export function validateTimer0PWMTimingConflict(
  usage: PeripheralUsage,
  boardConstants: BoardConstants | undefined,
): Diagnostic[] {
  const arch = boardConstants?.get('architecture');
  if (arch !== 'avr' || !usage.timer0 || usage.pwmPinsUsed.size === 0) {
    return [];
  }

  const timer0Pins = getTimer0PwmPins(boardConstants)
    .filter(pin => usage.pwmPinsUsed.has(pin.pinNumber));

  if (timer0Pins.length === 0) {
    return [];
  }

  const boardName = boardConstants?.get('name');
  const boardLabel = typeof boardName === 'string' && boardName.length > 0
    ? ` on ${boardName}`
    : '';

  const pinReferences = timer0Pins
    .sort((left, right) => left.pinNumber - right.pinNumber)
    .map((pin) => {
      const usedName = [pin.canonicalName, ...pin.aliases].find(name => usage.pinsUsed.has(name)) ?? pin.canonicalName;
      return formatPinReference(usedName, findBoardPinByName(pin.canonicalName, boardConstants));
    });

  return [{
    severity: 'info',
    code: 'timer0-pwm-timing-conflict',
    source: 'timer0-pwm-timing-conflict',
    message: `${pinReferences.join(', ')} use Timer0 PWM${boardLabel}, and your program also relies on Timer0-backed timing APIs such as delay(), millis(), or micros(). This coupling is common on AVR boards, so prefer non-Timer0 PWM pins when you want PWM behavior isolated from core timing.`,
  }];
}