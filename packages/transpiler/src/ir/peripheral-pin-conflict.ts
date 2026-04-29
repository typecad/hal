// ---------------------------------------------------------------------------
// Peripheral Pin Conflict Validation
//
// Detects when pins with peripheral functions (I2C, SPI, UART) are used as
// GPIO while the peripheral is active, and vice versa. This is bidirectional:
//   1. GPIO on peripheral pins (pin used as GPIO while peripheral is active)
//   2. Peripheral on GPIO pins (peripheral used while pin is configured as GPIO)
//
// Peripheral pin mappings are sourced from the board definition's
// pins.i2c, pins.spi, and pins.uart fields — no hardcoded maps.
// ---------------------------------------------------------------------------

import type { PeripheralUsage } from './peripheral-usage';
import type { BoardConstants } from './board-resolver';
import type { Diagnostic } from '../types';
import type { PeripheralFunction } from '@typehal/schema';
import { findBoardPinByName, formatPinReference, getBoardPins } from './board-pin-utils';

/**
 * Board peripheral pin map — sourced from board definition.
 */
type PeripheralPinMap = Map<string, PeripheralFunction[]>;

function getPinMetadataField(
  pinName: string,
  field: 'warnings' | 'notes' | 'alternateFunctions',
  boardConstants: BoardConstants | undefined,
): string | undefined {
  const pin = findBoardPinByName(pinName, boardConstants);
  if (!pin) {
    return undefined;
  }

  switch (field) {
  case 'warnings':
    return pin.warnings[0];
  case 'notes':
    return pin.note;
  case 'alternateFunctions':
    return pin.alternateFunctions.join(', ');
  }
}

/**
 * Build a peripheral pin map from board constants.
 * Reads pins.i2c, pins.spi, pins.uart from the resolved board definition.
 *
 * Expected board constant structure:
 *   pins.i2c     -> "0:sda=A4,scl=A5;1:sda=...,scl=..."  (or similar encoding)
 *   pins.spi     -> "0:mosi=D11,miso=D12,sck=D13,cs=D10"
 *   pins.uart    -> "0:tx=D1,rx=D0"
 *
 * For backward compatibility, also supports the legacy per-key format:
 *   pins.i2c.0.sda -> "A4"
 *   pins.i2c.0.scl -> "A5"
 *   pins.spi.0.mosi -> "D11"
 *   etc.
 */
function buildPeripheralPinMap(boardConstants: BoardConstants | undefined): PeripheralPinMap {
  const map = new Map<string, PeripheralFunction[]>();
  const boardPins = getBoardPins(boardConstants);
  const pinsByCanonicalName = new Map(boardPins.map(pin => [pin.name, pin]));

  if (!boardConstants) return map;

  // Helper to add a pin function
  function addPin(pinName: string, func: PeripheralFunction) {
    const boardPin = pinsByCanonicalName.get(pinName);
    const pinNames = boardPin ? [boardPin.name, ...boardPin.aliases] : [pinName];

    for (const resolvedPinName of pinNames) {
      const existing = map.get(resolvedPinName) ?? [];
      existing.push(func);
      map.set(resolvedPinName, existing);
    }
  }

  // Try to parse I2C pins
  // Format: "0:sda=A4,scl=A5" or individual keys like "pins.i2c.0.sda" = "A4"
  const i2cData = boardConstants.get('pins.i2c');
  if (typeof i2cData === 'string' && i2cData.length > 0) {
    // Parse semicolon-separated bus instances
    for (const busStr of i2cData.split(';')) {
      const colonIdx = busStr.indexOf(':');
      if (colonIdx === -1) continue;
      const instance = parseInt(busStr.slice(0, colonIdx), 10);
      const pinsStr = busStr.slice(colonIdx + 1);

      const pinPairs = pinsStr.split(',');
      for (const pair of pinPairs) {
        const eqIdx = pair.indexOf('=');
        if (eqIdx === -1) continue;
        const role = pair.slice(0, eqIdx).trim();
        const pinName = pair.slice(eqIdx + 1).trim();
        if (pinName) {
          addPin(pinName, { type: 'i2c', instance, role });
        }
      }
    }
  } else {
    // Fallback: check individual keys (pins.i2c.0.sda, pins.i2c.0.scl, etc.)
    for (const [key, value] of boardConstants) {
      if (typeof value !== 'string') continue;
      const match = key.match(/^pins\.i2c\.(\d+)\.(sda|scl)$/);
      if (match) {
        const instance = parseInt(match[1], 10);
        const role = match[2];
        addPin(value, { type: 'i2c', instance, role });
      }
    }
  }

  // Try to parse SPI pins
  const spiData = boardConstants.get('pins.spi');
  if (typeof spiData === 'string' && spiData.length > 0) {
    for (const busStr of spiData.split(';')) {
      const colonIdx = busStr.indexOf(':');
      if (colonIdx === -1) continue;
      const instance = parseInt(busStr.slice(0, colonIdx), 10);
      const pinsStr = busStr.slice(colonIdx + 1);

      const pinPairs = pinsStr.split(',');
      for (const pair of pinPairs) {
        const eqIdx = pair.indexOf('=');
        if (eqIdx === -1) continue;
        const role = pair.slice(0, eqIdx).trim();
        const pinName = pair.slice(eqIdx + 1).trim();
        if (pinName) {
          addPin(pinName, { type: 'spi', instance, role });
        }
      }
    }
  } else {
    for (const [key, value] of boardConstants) {
      if (typeof value !== 'string') continue;
      const match = key.match(/^pins\.spi\.(\d+)\.(mosi|miso|sck|cs)$/);
      if (match) {
        const instance = parseInt(match[1], 10);
        const role = match[2];
        addPin(value, { type: 'spi', instance, role });
      }
    }
  }

  // Try to parse UART pins
  const uartData = boardConstants.get('pins.uart');
  if (typeof uartData === 'string' && uartData.length > 0) {
    for (const busStr of uartData.split(';')) {
      const colonIdx = busStr.indexOf(':');
      if (colonIdx === -1) continue;
      const instance = parseInt(busStr.slice(0, colonIdx), 10);
      const pinsStr = busStr.slice(colonIdx + 1);

      const pinPairs = pinsStr.split(',');
      for (const pair of pinPairs) {
        const eqIdx = pair.indexOf('=');
        if (eqIdx === -1) continue;
        const role = pair.slice(0, eqIdx).trim();
        const pinName = pair.slice(eqIdx + 1).trim();
        if (pinName) {
          addPin(pinName, { type: 'uart', instance, role });
        }
      }
    }
  } else {
    for (const [key, value] of boardConstants) {
      if (typeof value !== 'string') continue;
      const match = key.match(/^pins\.uart\.(\d+)\.(tx|rx|rts|cts)$/);
      if (match) {
        const instance = parseInt(match[1], 10);
        const role = match[2];
        addPin(value, { type: 'uart', instance, role });
      }
    }
  }

  return map;
}

/**
 * Check if a pin is used as GPIO (digital/analog operations, not peripheral init).
 */
function isPinUsedAsGpio(pinName: string, usage: PeripheralUsage): boolean {
  return usage.pinsUsed.has(pinName);
}

/**
 * Check if a peripheral is active based on usage.
 */
function isPeripheralActive(type: 'i2c' | 'spi' | 'uart', instance: number, usage: PeripheralUsage): boolean {
  switch (type) {
  case 'i2c':
    return usage.i2c || usage.i2cInstancesUsed.has(instance);
  case 'spi':
    return usage.spi || usage.spiInstancesUsed.has(instance);
  case 'uart':
    return usage.uart || usage.uartInstancesUsed.has(instance);
  default:
    return false;
  }
}

/**
 * Get a human-readable name for a peripheral.
 */
function getPeripheralName(type: 'i2c' | 'spi' | 'uart', instance: number): string {
  switch (type) {
  case 'i2c':
    return `I2C${instance}`;
  case 'spi':
    return `SPI${instance}`;
  case 'uart':
    return instance === 0 ? 'Serial' : `Serial${instance}`;
  }
}

/**
 * Get all PWM-capable pins from board constants (for actionable error messages).
 */
function getPwmPins(boardConstants: BoardConstants | undefined): string[] {
  const pwmData = boardConstants?.get('pins.pwm');
  if (typeof pwmData === 'string' && pwmData.length > 0) {
    return pwmData.split(',').map(s => s.trim());
  }
  return [];
}

/**
 * Get all analog pins from board constants (for actionable error messages).
 */
function getAnalogPins(boardConstants: BoardConstants | undefined): string[] {
  const analogData = boardConstants?.get('pins.analog');
  if (typeof analogData === 'string' && analogData.length > 0) {
    return analogData.split(',').map(s => s.trim());
  }
  return [];
}

/**
 * Generate an actionable suggestion for a pin conflict.
 */
function generateSuggestion(
  pinName: string,
  peripheralName: string,
  role: string,
  boardConstants: BoardConstants | undefined,
): string {
  const roleUpper = role.toUpperCase();

  // Provide specific alternatives based on which pin is in conflict
  if (peripheralName === 'Serial' || peripheralName.startsWith('Serial')) {
    return `Consider using a different pin for GPIO, or avoid calling Serial.begin() if you need ${pinName} as GPIO.`;
  }

  if (roleUpper === 'SDA' || roleUpper === 'SCL') {
    const analogPins = getAnalogPins(boardConstants);
    if (analogPins.length > 0) {
      return `I2C requires ${roleUpper}. Use a different pin for GPIO, or consider a board with alternate I2C pins.`;
    }
    return `I2C requires ${roleUpper} on ${pinName}. Avoid using this pin for GPIO while I2C is active.`;
  }

  if (roleUpper === 'MOSI' || roleUpper === 'MISO' || roleUpper === 'SCK') {
    return `SPI requires ${roleUpper} on ${pinName}. Use a different pin for GPIO, or avoid calling SPI.begin() if you need ${pinName} as GPIO.`;
  }

  if (roleUpper === 'CS') {
    return `SPI uses ${pinName} as chip select. You can reassign CS to another digital pin if needed.`;
  }

  return `Use a different pin for GPIO, or avoid initializing ${peripheralName} if you need ${pinName} as GPIO.`;
}

/**
 * Validate peripheral pin conflicts (bidirectional).
 *
 * Checks both directions:
 * 1. Pin used as GPIO while peripheral is active
 * 2. Peripheral used while pin is configured as GPIO
 *
 * @param usage - Peripheral usage analysis
 * @param boardConstants - Resolved board constants (source of pin-peripheral mapping)
 * @returns Array of diagnostics for peripheral pin conflicts
 */
export function validatePeripheralPinConflicts(
  usage: PeripheralUsage,
  boardConstants: BoardConstants | undefined,
): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];

  // Build peripheral pin map from board definition (not hardcoded)
  const pinMap = buildPeripheralPinMap(boardConstants);
  if (pinMap.size === 0) return diagnostics;  // No peripheral pin data available

  // Track which conflicts we've already reported (avoid duplicates)
  const reportedConflicts = new Set<string>();

  // Check each pin with peripheral functions
  for (const [pinName, functions] of pinMap) {
    const isGpio = isPinUsedAsGpio(pinName, usage);

    for (const func of functions) {
      if (func.type !== 'i2c' && func.type !== 'spi' && func.type !== 'uart') continue;
      const isActive = isPeripheralActive(func.type, func.instance, usage);
      const peripheralName = getPeripheralName(func.type, func.instance);
      const canonicalPinName = findBoardPinByName(pinName, boardConstants)?.name ?? pinName;
      const conflictKey = `${canonicalPinName}:${peripheralName}`;

      // Direction 1: Pin used as GPIO while peripheral is active
      if (isGpio && isActive) {
        if (!reportedConflicts.has(conflictKey)) {
          reportedConflicts.add(conflictKey);
          const roleUpper = func.role.toUpperCase();
          const suggestion = generateSuggestion(pinName, peripheralName, func.role, boardConstants);
          const warningText = getPinMetadataField(pinName, 'warnings', boardConstants)?.split(',')[0].trim();
          const pinReference = formatPinReference(pinName, findBoardPinByName(pinName, boardConstants));
          const baseMessage = warningText
            ? `${pinReference} is ${peripheralName} ${roleUpper}. ${warningText}`
            : `${pinReference} is ${peripheralName} ${roleUpper}. Using as GPIO may interfere with ${peripheralName} communication.`;

          diagnostics.push({
            severity: 'warning',
            message: `${baseMessage}\n   → ${suggestion}`,
            code: 'peripheral-pin-conflict',
            source: 'peripheral-pin-conflict',
          });
        }
      }

      // Direction 2: Peripheral active while pin is used as GPIO
      // This catches the case where GPIO is configured first, then peripheral is initialized
      // (Already covered by direction 1 since both conditions are symmetric, but
      //  the message orientation helps users understand the conflict regardless of code order)
    }
  }

  return diagnostics;
}

