// ---------------------------------------------------------------------------
// Peripheral Pin Conflict Validation
//
// Detects when pins with peripheral functions (I2C, SPI, UART) are used as
// GPIO while the peripheral is active, which can cause communication issues.
// ---------------------------------------------------------------------------

import type { PeripheralUsage } from './peripheral-usage';
import type { Diagnostic } from '../types';

/**
 * Maps a pin name to its peripheral functions.
 * Multiple peripherals can share the same pin (e.g., A4 is both ADC ch4 and I2C0 SDA).
 */
interface PeripheralFunction {
  type: 'i2c' | 'spi' | 'uart';
  instance: number;
  role: string;  // sda, scl, mosi, miso, sck, cs, tx, rx
}

/**
 * Board-specific peripheral pin mappings.
 * Key is the pin name (e.g., 'A4', 'D11'), value is array of peripheral functions.
 */
type PeripheralPinMap = Map<string, PeripheralFunction[]>;

/**
 * Arduino Uno peripheral pin mappings.
 * A4/A5 = I2C0, D11/D12/D13 = SPI0, D0/D1 = UART0
 */
const ARDUINO_UNO_PERIPHERAL_PINS: PeripheralPinMap = new Map([
  // I2C0
  ['A4', [{ type: 'i2c', instance: 0, role: 'sda' }]],
  ['A5', [{ type: 'i2c', instance: 0, role: 'scl' }]],
  // SPI0
  ['D11', [{ type: 'spi', instance: 0, role: 'mosi' }]],
  ['D12', [{ type: 'spi', instance: 0, role: 'miso' }]],
  ['D13', [{ type: 'spi', instance: 0, role: 'sck' }]],
  ['D10', [{ type: 'spi', instance: 0, role: 'cs' }]],
  // UART0
  ['D0', [{ type: 'uart', instance: 0, role: 'rx' }]],
  ['D1', [{ type: 'uart', instance: 0, role: 'tx' }]],
]);

/**
 * Map of board IDs to their peripheral pin mappings.
 */
const BOARD_PERIPHERAL_PINS: Map<string, PeripheralPinMap> = new Map([
  ['arduino-uno', ARDUINO_UNO_PERIPHERAL_PINS],
  // Add more boards as needed
]);

/**
 * Check if a pin is used as GPIO (digital/analog operations, not peripheral init).
 */
function isPinUsedAsGpio(pinName: string, usage: PeripheralUsage): boolean {
  // Check if pin is in pinsUsed set (tracks digital, pwm, analog-input, interrupt pins)
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
 * Validate peripheral pin conflicts.
 *
 * @param usage - Peripheral usage analysis
 * @param boardId - Board identifier (e.g., 'arduino-uno')
 * @returns Array of diagnostics for peripheral pin conflicts
 */
export function validatePeripheralPinConflicts(
  usage: PeripheralUsage,
  boardId: string | undefined,
): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];

  if (!boardId) return diagnostics;

  // Get peripheral pin map for this board
  const pinMap = BOARD_PERIPHERAL_PINS.get(boardId);
  if (!pinMap) return diagnostics;  // Unknown board, skip validation

  // Check each pin with peripheral functions
  for (const [pinName, functions] of pinMap) {
    // Only check if pin is being used as GPIO
    if (!isPinUsedAsGpio(pinName, usage)) continue;

    // Check each peripheral function on this pin
    for (const func of functions) {
      if (isPeripheralActive(func.type, func.instance, usage)) {
        const peripheralName = getPeripheralName(func.type, func.instance);
        const roleUpper = func.role.toUpperCase();

        diagnostics.push({
          severity: 'warning',
          message: `Pin '${pinName}' is ${peripheralName} ${roleUpper}. Using as GPIO may interfere with ${peripheralName} communication.`,
          code: 'peripheral-pin-conflict',
          source: 'peripheral-pin-conflict',
        });
      }
    }
  }

  return diagnostics;
}

/**
 * Get all pins that have peripheral functions for a board.
 * Useful for documentation or IDE features.
 */
export function getPeripheralPins(boardId: string): PeripheralPinMap | undefined {
  return BOARD_PERIPHERAL_PINS.get(boardId);
}
