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

  return {
    i2c: (boardConstants.get('peripherals.i2c.count') as number) ?? 1,
    spi: (boardConstants.get('peripherals.spi.count') as number) ?? 1,
    uart: (boardConstants.get('peripherals.uart.count') as number) ?? 1,
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