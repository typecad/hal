// ---------------------------------------------------------------------------
// Peripheral Instance Validation
//
// Validates that peripheral instances used in the program are available
// on the target board. Generates compile-time errors for invalid usage.
// ---------------------------------------------------------------------------

import { PeripheralUsage } from './peripheral-usage.js';
import { BoardConstants } from './board-resolver.js';
import { Diagnostic } from '../types.js';

/**
 * Peripheral capacity info (internal).
 */
interface PeripheralCapacity {
  i2c: number;      // Number of I2C buses (e.g., 1 for Arduino Uno)
  spi: number;      // Number of SPI buses
  uart: number;     // Number of UART ports
}

/**
 * Get peripheral capacity from board constants.
 *
 * The count comes from an explicit `peripherals.<bus>.count` key when the
 * board carries one; otherwise it is derived from the flattened instance
 * entries (`peripherals.<bus>.<N>.instance`, produced by the MCU package's
 * *_INSTANCES arrays) so a board whose MCU declares two I2C controllers
 * accepts I2C1 (the Arduino-pico and ESP32 cores both expose the second
 * bus). Only when neither form is present does it fall back to 1.
 */
function getPeripheralCapacity(boardConstants: BoardConstants | undefined): PeripheralCapacity {
  const defaultCapacity: PeripheralCapacity = {
    i2c: 1,
    spi: 1,
    uart: 1,
  };

  if (!boardConstants) {
    return defaultCapacity;
  }

  const capacityFor = (bus: 'i2c' | 'spi' | 'uart'): number => {
    const explicit = boardConstants.get(`peripherals.${bus}.count`) as number | undefined;
    if (typeof explicit === 'number') return explicit;
    let highest = -1;
    for (let i = 0; i < 16; i++) {
      const instance = boardConstants.get(`peripherals.${bus}.${i}.instance`);
      if (instance === undefined) break;
      highest = i;
    }
    return highest >= 0 ? highest + 1 : 1;
  };

  return {
    i2c: capacityFor('i2c'),
    spi: capacityFor('spi'),
    uart: capacityFor('uart'),
  };
}

/**
 * Validate peripheral usage against board capacity.
 * Returns an array of diagnostics for any invalid peripheral usage.
 */
function validatePeripheralUsage(
  usage: PeripheralUsage,
  capacity: PeripheralCapacity,
  boardName: string,
  filePath: string,
): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];

  // Validate I2C instances
  for (const instance of usage.i2cInstancesUsed) {
    if (instance >= capacity.i2c) {
      const availableName = capacity.i2c === 1 ? 'I2C0' : `I2C0 through I2C${capacity.i2c - 1}`;
      diagnostics.push({
        severity: 'error',
        message: `I2C${instance} is not available on ${boardName}. Available: ${availableName}`,
        code: 'peripheral-not-available',
        filePath,
        source: 'peripheral-validation',
      });
    }
  }

  // Validate SPI instances
  for (const instance of usage.spiInstancesUsed) {
    if (instance >= capacity.spi) {
      const availableName = capacity.spi === 1 ? 'SPI0' : `SPI0 through SPI${capacity.spi - 1}`;
      diagnostics.push({
        severity: 'error',
        message: `SPI${instance} is not available on ${boardName}. Available: ${availableName}`,
        code: 'peripheral-not-available',
        filePath,
        source: 'peripheral-validation',
      });
    }
  }

  // Validate UART instances
  for (const instance of usage.uartInstancesUsed) {
    if (instance >= capacity.uart) {
      const availableName = capacity.uart === 1 ? 'UART0 (Serial)' : `UART0 through UART${capacity.uart - 1}`;
      diagnostics.push({
        severity: 'error',
        message: `UART${instance} is not available on ${boardName}. Available: ${availableName}`,
        code: 'peripheral-not-available',
        filePath,
        source: 'peripheral-validation',
      });
    }
  }

  return diagnostics;
}

/**
 * Validate peripheral usage and return diagnostics.
 * This is the main entry point for peripheral validation.
 */
export function validatePeripherals(
  usage: PeripheralUsage,
  boardConstants: BoardConstants | undefined,
  filePath: string,
): Diagnostic[] {
  const capacity = getPeripheralCapacity(boardConstants);
  const boardName = boardConstants?.get('name') as string ?? 'this board';
  return validatePeripheralUsage(usage, capacity, boardName, filePath);
}