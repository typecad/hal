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
 * Check a peripheral config value via the appropriate checker. Emits a
 * diagnostic if the value looks like a unit mistake (kHz instead of Hz, a
 * baud rate used as SPI freq, etc.). Only literal numbers are checked —
 * expressions/variables are opaque to this validator.
 */
function checkConfigValue(
  kind: 'baud' | 'i2c' | 'spi',
  rawValue: unknown,
  filePath: string | undefined,
  diagnostics: Diagnostic[],
): void {
  // HAL ops carry resolved numeric values as `number` when the source arg was
  // a literal, or as `string` expression text otherwise. Only check numbers.
  const value = typeof rawValue === 'number' ? rawValue
    : typeof rawValue === 'string' && /^\d+$/.test(rawValue) ? parseInt(rawValue, 10)
    : null;
  if (value === null) return;

  const message =
    kind === 'baud' ? checkBaudRate(value)
    : kind === 'i2c' ? checkI2CSpeed(value)
    : checkSPIFrequency(value);
  if (message) {
    diagnostics.push({
      severity: 'warning',
      message,
      code: 'unit-suspicion',
      filePath,
      source: 'unit-suspicion-validation',
    });
  }
}

/**
 * Recursively scan a statement and its children for suspicious peripheral
 * config values. Recognizes the HAL ops that carry clock/baud/frequency
 * values (i2c.set_clock, uart.begin, spi.begin_transaction) and call
 * statements whose callee matches known config method names.
 */
function scanStatement(stmt: StatementIR, diagnostics: Diagnostic[]): void {
  if (!stmt || typeof stmt !== 'object') return;
  const s = stmt as any;
  const filePath = s.sourceSpan?.filePath;

  // HAL-op statements carry structured operations with resolved values.
  if (stmt.kind === 'hal-op' && s.operation) {
    const op = s.operation;
    switch (op.operation) {
      case 'i2c.set_clock':
        checkConfigValue('i2c', op.hz, filePath, diagnostics);
        break;
      case 'uart.begin':
        checkConfigValue('baud', op.baud, filePath, diagnostics);
        break;
      // SPI frequency flows through SPISettings construction text, which the
      // HAL op carries as a string — the numeric extraction in
      // checkConfigValue handles bare-digit strings.
      case 'spi.begin_transaction':
        if (typeof op.settings === 'string') {
          // SPISettings({freq}, ...) — try to extract the leading frequency.
          const m = op.settings.match(/^\s*(\d+)/);
          if (m) checkConfigValue('spi', parseInt(m[1], 10), filePath, diagnostics);
        }
        break;
    }
  }

  // Call statements: match config method names with a numeric literal arg.
  // This catches pre-HAL-resolution calls and library-level config helpers.
  if (stmt.kind === 'call' && typeof s.callee === 'string' && Array.isArray(s.args)) {
    const method = s.callee.split('.').pop() ?? s.callee;
    if (method === 'setClock' && s.args.length >= 2) {
      checkConfigValue('i2c', extractNumericValue(s.args[1]), filePath, diagnostics);
    } else if (method === 'setBaudRate' || method === 'begin') {
      // Serial.begin(baud) / setBaudRate(baud) — last numeric arg is the baud.
      for (const arg of s.args) {
        const v = extractNumericValue(arg);
        if (v !== undefined) checkConfigValue('baud', v, filePath, diagnostics);
      }
    } else if (method === 'setFrequency' && s.args.length >= 2) {
      checkConfigValue('spi', extractNumericValue(s.args[1]), filePath, diagnostics);
    }
  }

  // Recurse into nested statements
  if (s.body && Array.isArray(s.body)) {
    for (const child of s.body) scanStatement(child, diagnostics);
  }
  if (s.thenBranch && Array.isArray(s.thenBranch)) {
    for (const child of s.thenBranch) scanStatement(child, diagnostics);
  }
  if (s.elseBranch && Array.isArray(s.elseBranch)) {
    for (const child of s.elseBranch) scanStatement(child, diagnostics);
  }
  if (s.statements && Array.isArray(s.statements)) {
    for (const child of s.statements) scanStatement(child, diagnostics);
  }
  if (s.initializer && typeof s.initializer === 'object' && s.initializer.kind) {
    scanStatement(s.initializer, diagnostics);
  }
  if (s.increment && typeof s.increment === 'object' && s.increment.kind) {
    scanStatement(s.increment, diagnostics);
  }
  if (s.cases && Array.isArray(s.cases)) {
    for (const c of s.cases) {
      if (c.body && Array.isArray(c.body)) {
        for (const child of c.body) scanStatement(child, diagnostics);
      }
    }
  }
  if (s.tryBlock && Array.isArray(s.tryBlock)) {
    for (const child of s.tryBlock) scanStatement(child, diagnostics);
  }
  if (s.catchBlock && Array.isArray(s.catchBlock)) {
    for (const child of s.catchBlock) scanStatement(child, diagnostics);
  }
  if (s.finallyBlock && Array.isArray(s.finallyBlock)) {
    for (const child of s.finallyBlock) scanStatement(child, diagnostics);
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
