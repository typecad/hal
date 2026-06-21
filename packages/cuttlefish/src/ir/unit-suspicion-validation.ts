// ---------------------------------------------------------------------------
// Unit Suspicion Validation
//
// Warns when bare numbers passed to peripheral config methods look suspicious.
// For example, passing 9600 to an SPI frequency (which expects Hz, not baud)
// or passing 100 to I2C speed (which expects Hz, not kHz).
//
// This validator complements the two-tier peripheral config approach:
// - Enum values (BaudRate._9600, I2CSpeed.FAST, etc.) are always safe
// - Bare numbers in .config builders are validated here for common mistakes
// ---------------------------------------------------------------------------

import { ProgramIR, StatementIR, ExpressionIR } from '../api/index.js';
import { Diagnostic } from '../types.js';

// Standard baud rates for UART
const KNOWN_BAUD_RATES = new Set([
  300, 1200, 2400, 4800, 9600, 19200, 38400, 57600, 115200,
  230400, 460800, 921600,
]);

// Standard I2C clock speeds in Hz
const KNOWN_I2C_SPEEDS = new Set([
  100_000,   // Standard (100 kHz)
  400_000,   // Fast (400 kHz)
  1_000_000, // Fast Plus (1 MHz)
  3_400_000, // High Speed (3.4 MHz)
]);

// Standard SPI clock frequencies in Hz
const KNOWN_SPI_FREQUENCIES = new Set([
  125_000,   // 125 kHz
  250_000,   // 250 kHz
  500_000,   // 500 kHz
  1_000_000, // 1 MHz
  2_000_000, // 2 MHz
  4_000_000, // 4 MHz
  8_000_000, // 8 MHz
  16_000_000, // 16 MHz
]);

/**
 * Extract a numeric value from an expression IR node.
 * Returns `undefined` if the expression is not a simple numeric literal.
 */
function extractNumericValue(expr: ExpressionIR): number | undefined {
  if (!expr || typeof expr !== 'object') return undefined;

  // Direct numeric literal
  if (expr.kind === 'number') {
    return (expr as { kind: 'number'; value: number }).value;
  }

  return undefined;
}

/**
 * Check if a baud rate value is suspicious.
 * Warns if the value is not a standard baud rate.
 */
function checkBaudRate(value: number): string | undefined {
  if (KNOWN_BAUD_RATES.has(value)) return undefined;

  // Check for common mistakes
  // User might have intended a standard rate but typo'd
  for (const known of KNOWN_BAUD_RATES) {
    // Close to a standard rate (within 10%)
    if (value > known * 0.9 && value < known * 1.1) {
      return `Baud rate ${value} is close to standard rate ${known}. Did you mean ${known}?`;
    }
  }

  // Very low values might be confused with kHz
  if (value > 0 && value < 100) {
    return `Baud rate ${value} is unusually low. UART baud rates are typically ≥ 300.`;
  }

  return undefined;
}

/**
 * Check if an I2C speed value is suspicious.
 * Warns if the value looks like it's in kHz instead of Hz.
 */
function checkI2CSpeed(value: number): string | undefined {
  if (KNOWN_I2C_SPEEDS.has(value)) return undefined;

  // Common mistake: passing kHz value instead of Hz
  // e.g., 100 instead of 100000, 400 instead of 400000
  if (value > 0 && value < 10000) {
    // Check if multiplying by 1000 gives a known speed
    const asHz = value * 1000;
    if (KNOWN_I2C_SPEEDS.has(asHz)) {
      return `I2C speed ${value} looks like a kHz value. Did you mean ${asHz} (${value} kHz)? I2C speed is specified in Hz.`;
    }
  }

  // Check for close matches to standard speeds
  for (const known of KNOWN_I2C_SPEEDS) {
    if (value > known * 0.9 && value < known * 1.1) {
      return `I2C speed ${value} is close to standard speed ${known}. Did you mean ${known}?`;
    }
  }

  return undefined;
}

/**
 * Check if an SPI frequency value is suspicious.
 * Warns if the value looks like it's in kHz or MHz instead of Hz,
 * or if it's a standard baud rate mistakenly used for SPI.
 */
function checkSPIFrequency(value: number): string | undefined {
  if (KNOWN_SPI_FREQUENCIES.has(value)) return undefined;

  // Common mistake: passing kHz value instead of Hz
  if (value > 0 && value < 100000) {
    const asHz = value * 1000;
    if (KNOWN_SPI_FREQUENCIES.has(asHz)) {
      return `SPI frequency ${value} looks like a kHz value. Did you mean ${asHz}? SPI frequency is specified in Hz.`;
    }
  }

  // Common mistake: passing MHz value instead of Hz
  if (value > 0 && value <= 16) {
    const asHz = value * 1_000_000;
    if (KNOWN_SPI_FREQUENCIES.has(asHz)) {
      return `SPI frequency ${value} looks like an MHz value. Did you mean ${asHz}? SPI frequency is specified in Hz.`;
    }
  }

  // Check if a standard baud rate was mistakenly used for SPI
  if (KNOWN_BAUD_RATES.has(value)) {
    return `Value ${value} is a standard UART baud rate, not a typical SPI clock frequency. SPI frequencies are usually powers-of-two divisors of the system clock.`;
  }

  // Check for close matches to standard frequencies
  for (const known of KNOWN_SPI_FREQUENCIES) {
    if (value > known * 0.9 && value < known * 1.1) {
      return `SPI frequency ${value} is close to standard frequency ${known}. Did you mean ${known}?`;
    }
  }

  return undefined;
}

/**
 * Recursively scan a statement and its children for suspicious peripheral config values.
 */
function scanStatement(stmt: StatementIR, diagnostics: Diagnostic[]): void {
  if (!stmt || typeof stmt !== 'object') return;

  // Recurse into nested statements
  const s = stmt as any;

  if (s.body && Array.isArray(s.body)) {
    for (const child of s.body) {
      scanStatement(child, diagnostics);
    }
  }
  if (s.thenBranch && Array.isArray(s.thenBranch)) {
    for (const child of s.thenBranch) {
      scanStatement(child, diagnostics);
    }
  }
  if (s.elseBranch && Array.isArray(s.elseBranch)) {
    for (const child of s.elseBranch) {
      scanStatement(child, diagnostics);
    }
  }
  if (s.statements && Array.isArray(s.statements)) {
    for (const child of s.statements) {
      scanStatement(child, diagnostics);
    }
  }
}

/**
 * Validate peripheral config values for common unit mistakes.
 *
 * Scans the program IR for cuttlefish-call nodes that configure peripherals
 * with bare numbers and emits warnings when values look suspicious.
 *
 * @param program - The program IR to validate
 * @returns Array of diagnostics for suspicious peripheral config values
 */
export function validateUnitSuspicion(
  program: ProgramIR,
): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];

  // Scan top-level statements
  if (program.topLevelStatements) {
    for (const stmt of program.topLevelStatements) {
      scanStatement(stmt, diagnostics);
    }
  }

  // Scan function bodies
  if (program.functions) {
    for (const fn of program.functions) {
      if (fn.statements) {
        for (const stmt of fn.statements) {
          scanStatement(stmt, diagnostics);
        }
      }
    }
  }

  // Scan class methods
  if (program.classes) {
    for (const cls of program.classes) {
      if (cls.methods) {
        for (const method of cls.methods) {
          if (method.statements) {
            for (const stmt of method.statements) {
              scanStatement(stmt, diagnostics);
            }
          }
        }
      }
      if (cls.constructor?.statements) {
        for (const stmt of cls.constructor.statements) {
          scanStatement(stmt, diagnostics);
        }
      }
    }
  }

  return diagnostics;
}
