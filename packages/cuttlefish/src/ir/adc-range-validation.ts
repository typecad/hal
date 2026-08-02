// ---------------------------------------------------------------------------
// ADC Range Validation
//
// Detects comparisons against analogRead() values that exceed the board's
// ADC resolution (e.g., comparing to > 1023 on a 10-bit Arduino Uno).
// ---------------------------------------------------------------------------

import type { ProgramIR, ExpressionIR, StatementIR } from '../api/index.js';
import type { BoardConstants } from '../api/shared/index.js';
import type { Diagnostic } from '../types.js';
import { hasLoadedFramework, getLoadedFramework } from '../framework-registry.js';

/**
 * Board-specific ADC configurations.
 * Resolution is in bits; max value = (2^resolution) - 1.
 */
interface ADCConfig {
  resolution: number;
  maxValue: number;
}

/**
 * Get ADC configuration from board constants.
 */
function getADCConfig(boardConstants: BoardConstants | undefined): ADCConfig | null {
  if (!boardConstants) return null;

  // Try to get ADC resolution from board constants
  const resolution = boardConstants.get('peripherals.adc.0.resolution') as number | undefined;

  if (resolution !== undefined) {
    return {
      resolution,
      maxValue: Math.pow(2, resolution) - 1,
    };
  }

  // No board ADC resolution available — cannot validate
  return null;
}

/**
 * Check if an expression is an analog read.
 *
 * Two IR shapes carry an ADC read inline:
 *   - `hal-expr` with operation `adc.read` / `adc.read_voltage` (the structured
 *     HAL form — the common case for `A0.readAnalog()` inline in a comparison)
 *   - `raw` whose value text contains `analogRead(` (the lowered text form,
 *     reached when the HAL op has already been resolved to C++ text)
 * An assignment `const v = A0.readAnalog(); if (v > 2000)` is NOT caught — `v`
 * is an identifier by the comparison site, and correlating the two would
 * require data-flow analysis beyond this validator's scope.
 */
function isAnalogRead(expr: ExpressionIR): boolean {
  if (!expr || typeof expr !== 'object') return false;
  if (expr.kind === 'hal-expr') {
    const op = (expr as { operation?: { operation?: string } }).operation?.operation;
    return op === 'adc.read' || op === 'adc.read_voltage';
  }
  if (expr.kind === 'raw') {
    const value = (expr as { value: string }).value;
    // Ask the loaded framework which call names produce an ADC read; fall back
    // to the Wiring-derived analogRead when no framework is loaded.
    const frameworkNames = hasLoadedFramework()
      ? getLoadedFramework().strategy.analogReadCallNames?.()
      : undefined;
    const names = frameworkNames ?? new Set<string>(['analogRead']);
    for (const name of names) {
      const re = new RegExp(`${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\(`);
      if (re.test(value)) return true;
    }
    return false;
  }
  return false;
}

/**
 * Try to extract a numeric value from an expression.
 */
function extractNumericValue(expr: ExpressionIR): number | null {
  if (!expr || typeof expr !== 'object') return null;

  if (expr.kind === 'number') {
    return (expr as any).value;
  }

  return null;
}

/**
 * Check binary comparison expressions for ADC range issues.
 */
function checkComparisonForADCRange(
  left: ExpressionIR,
  operator: string,
  right: ExpressionIR,
  adcConfig: ADCConfig,
  filePath: string,
  diagnostics: Diagnostic[],
): void {
  // Check if one side is an analog read and the other is a literal
  let analogReadSide: 'left' | 'right' | null = null;
  let literalValue: number | null = null;

  if (isAnalogRead(left) && extractNumericValue(right) !== null) {
    analogReadSide = 'left';
    literalValue = extractNumericValue(right);
  } else if (isAnalogRead(right) && extractNumericValue(left) !== null) {
    analogReadSide = 'right';
    literalValue = extractNumericValue(left);
  }

  if (analogReadSide === null || literalValue === null) return;

  // Check if the literal exceeds ADC max
  if (literalValue > adcConfig.maxValue) {
    // Adjust operator based on which side the analog read is on
    const comparisonDesc = analogReadSide === 'left'
      ? `analogRead() ${operator} ${literalValue}`
      : `${literalValue} ${operator} analogRead()`;

    diagnostics.push({
      severity: 'info',
      message: `Comparison ${comparisonDesc} may never be true. ADC resolution is ${adcConfig.resolution}-bit (max ${adcConfig.maxValue}) on this board.`,
      code: 'adc-range-warning',
      filePath,
      source: 'adc-range-validation',
    });
  }
}

/**
 * Scan an expression for ADC range issues.
 */
function scanExpressionForADCRange(
  expr: ExpressionIR,
  adcConfig: ADCConfig,
  filePath: string,
  diagnostics: Diagnostic[],
): void {
  if (!expr || typeof expr !== 'object') return;

  // Check binary comparisons
  if (expr.kind === 'binary') {
    const bin = expr as any;
    const comparisonOps = ['>', '>=', '<', '<=', '===', '==', '!==', '!='];

    if (comparisonOps.includes(bin.operator)) {
      checkComparisonForADCRange(bin.left, bin.operator, bin.right, adcConfig, filePath, diagnostics);
    }

    // Recursively scan both sides
    scanExpressionForADCRange(bin.left, adcConfig, filePath, diagnostics);
    scanExpressionForADCRange(bin.right, adcConfig, filePath, diagnostics);
  }

  // Check ternary conditions
  if (expr.kind === 'ternary') {
    const ternary = expr as any;
    scanExpressionForADCRange(ternary.condition, adcConfig, filePath, diagnostics);
    scanExpressionForADCRange(ternary.whenTrue, adcConfig, filePath, diagnostics);
    scanExpressionForADCRange(ternary.whenFalse, adcConfig, filePath, diagnostics);
  }

  // Check property access
  if (expr.kind === 'property-access') {
    const pa = expr as any;
    scanExpressionForADCRange(pa.object, adcConfig, filePath, diagnostics);
  }
}

/**
 * Scan a statement for ADC range issues.
 */
function scanStatementForADCRange(
  stmt: StatementIR,
  adcConfig: ADCConfig,
  filePath: string,
  diagnostics: Diagnostic[],
): void {
  if (!stmt || typeof stmt !== 'object') return;

  switch (stmt.kind) {
  case 'var_decl': {
    const varDecl = stmt as any;
    if (varDecl.initializer) {
      scanExpressionForADCRange(varDecl.initializer, adcConfig, filePath, diagnostics);
    }
    break;
  }

  case 'assign': {
    const assign = stmt as any;
    if (assign.value) {
      scanExpressionForADCRange(assign.value, adcConfig, filePath, diagnostics);
    }
    break;
  }

  case 'if': {
    const ifStmt = stmt as any;
    if (ifStmt.condition) {
      scanExpressionForADCRange(ifStmt.condition, adcConfig, filePath, diagnostics);
    }
    if (ifStmt.thenBranch) {
      for (const s of ifStmt.thenBranch) {
        scanStatementForADCRange(s, adcConfig, filePath, diagnostics);
      }
    }
    if (ifStmt.elseBranch) {
      for (const s of ifStmt.elseBranch) {
        scanStatementForADCRange(s, adcConfig, filePath, diagnostics);
      }
    }
    break;
  }

  case 'while': {
    const whileStmt = stmt as any;
    if (whileStmt.condition) {
      scanExpressionForADCRange(whileStmt.condition, adcConfig, filePath, diagnostics);
    }
    if (whileStmt.body) {
      for (const s of whileStmt.body) {
        scanStatementForADCRange(s, adcConfig, filePath, diagnostics);
      }
    }
    break;
  }

  case 'for': {
    const forStmt = stmt as any;
    if (forStmt.condition) {
      scanExpressionForADCRange(forStmt.condition, adcConfig, filePath, diagnostics);
    }
    if (forStmt.body) {
      for (const s of forStmt.body) {
        scanStatementForADCRange(s, adcConfig, filePath, diagnostics);
      }
    }
    break;
  }

  case 'return': {
    const retStmt = stmt as any;
    if (retStmt.value) {
      scanExpressionForADCRange(retStmt.value, adcConfig, filePath, diagnostics);
    }
    break;
  }

  case 'call': {
    const call = stmt as any;
    if (call.args) {
      for (const arg of call.args) {
        scanExpressionForADCRange(arg, adcConfig, filePath, diagnostics);
      }
    }
    break;
  }

  default:
    break;
  }
}

/**
 * Validate ADC range comparisons in a program.
 *
 * @param program - The program IR to validate
 * @param boardConstants - Board constants containing ADC resolution
 * @returns Array of diagnostics for ADC range issues
 */
export function validateADCRange(
  program: ProgramIR,
  boardConstants: BoardConstants | undefined,
): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];

  const adcConfig = getADCConfig(boardConstants);
  if (!adcConfig) return diagnostics;

  // Scan top-level statements
  if (program.topLevelStatements) {
    for (const stmt of program.topLevelStatements) {
      scanStatementForADCRange(stmt, adcConfig, program.fileName, diagnostics);
    }
  }

  // Scan function bodies
  if (program.functions) {
    for (const fn of program.functions) {
      if (fn.statements) {
        for (const stmt of fn.statements) {
          scanStatementForADCRange(stmt, adcConfig, program.fileName, diagnostics);
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
              scanStatementForADCRange(stmt, adcConfig, program.fileName, diagnostics);
            }
          }
        }
      }
      if (cls.constructor?.statements) {
        for (const stmt of cls.constructor.statements) {
          scanStatementForADCRange(stmt, adcConfig, program.fileName, diagnostics);
        }
      }
    }
  }

  return diagnostics;
}
