// ---------------------------------------------------------------------------
// Interrupt Safety Analysis
//
// Detects unsafe operations inside interrupt handlers and duplicate handlers
// on the same pin.
// ---------------------------------------------------------------------------

import type { ProgramIR, StatementIR, ExpressionIR } from './model';
import type { PeripheralUsage } from './peripheral-usage';
import type { Diagnostic } from '../types';
import { registeredCallbacks } from './build-ir-state';

/** ISR-unsafe operation entry. */
export interface IsrUnsafeOp { reason: string; severity: 'warning' | 'info'; }

/**
 * Default ISR-unsafe operations used when no platform-specific map is provided.
 * Platforms should supply their own list via PlatformStrategy.isrUnsafeOperations().
 */
const DEFAULT_ISR_UNSAFE_OPERATIONS: Map<string, IsrUnsafeOp> = new Map([
  ['delay', { reason: 'delay() blocks the CPU and should not be used in interrupt context', severity: 'warning' }],
  ['delayMicroseconds', { reason: 'delayMicroseconds() blocks and should be avoided in ISRs', severity: 'warning' }],
  ['Serial.print', { reason: 'Serial.print() may not work correctly in interrupt context', severity: 'info' }],
  ['Serial.println', { reason: 'Serial.println() may not work correctly in interrupt context', severity: 'info' }],
  ['Serial.write', { reason: 'Serial.write() may not work correctly in interrupt context', severity: 'info' }],
  ['Serial.read', { reason: 'Serial.read() may not work correctly in interrupt context', severity: 'info' }],
  ['I2C0', { reason: 'I2C operations can cause lockups in interrupt context', severity: 'warning' }],
  ['I2C1', { reason: 'I2C operations can cause lockups in interrupt context', severity: 'warning' }],
  ['SPI0', { reason: 'SPI operations may cause issues in interrupt context', severity: 'info' }],
  ['SPI1', { reason: 'SPI operations may cause issues in interrupt context', severity: 'info' }],
]);

/**
 * Track interrupt handlers attached to pins.
 * Maps pin name to the number of handlers attached.
 */
export interface InterruptHandlerInfo {
  pinName: string;
  attachCount: number;
}

/**
 * Analyze a program for interrupt handler issues.
 *
 * @param program - The program IR to analyze
 * @param usage - Peripheral usage information
 * @param isrUnsafeOps - Platform-specific ISR-unsafe operations map (from strategy)
 * @returns Array of diagnostics for interrupt-related issues
 */
export function analyzeInterruptSafety(
  program: ProgramIR,
  usage: PeripheralUsage,
  isrUnsafeOps?: Map<string, IsrUnsafeOp>,
): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const unsafeOps = isrUnsafeOps ?? DEFAULT_ISR_UNSAFE_OPERATIONS;

  // Track duplicate handlers
  const handlersByPin: Map<string, number> = new Map();

  // Scan for attachInterrupt calls
  scanForInterruptHandlers(program, handlersByPin, diagnostics);

  // Scan for unsafe operations inside ISR callbacks
  scanForUnsafeOperations(program, diagnostics, unsafeOps);

  return diagnostics;
}

/**
 * Scan the program for attachInterrupt calls and detect duplicates.
 */
function scanForInterruptHandlers(
  program: ProgramIR,
  handlersByPin: Map<string, number>,
  diagnostics: Diagnostic[],
): void {
  // Scan top-level statements
  if (program.topLevelStatements) {
    for (const stmt of program.topLevelStatements) {
      scanStatementForInterruptHandler(stmt, handlersByPin, diagnostics);
    }
  }

  // Scan function bodies
  if (program.functions) {
    for (const fn of program.functions) {
      if (fn.statements) {
        for (const stmt of fn.statements) {
          scanStatementForInterruptHandler(stmt, handlersByPin, diagnostics);
        }
      }
    }
  }
}

/**
 * Scan a statement for attachInterrupt calls.
 */
function scanStatementForInterruptHandler(
  stmt: StatementIR,
  handlersByPin: Map<string, number>,
  diagnostics: Diagnostic[],
): void {
  if (!stmt || typeof stmt !== 'object') return;

  // Check for typehal-call statements — both the low-level pin.attachInterrupt() and
  // the flat sugar API (pin.onFalling / pin.onRising / pin.onChange / etc.) which all
  // lower to a single attachInterrupt call on the same hardware interrupt line.
  const ATTACH_METHODS = new Set(['attachInterrupt', 'onFalling', 'onRising', 'onChange', 'onLow', 'onHigh']);

  // Recursively scan nested statements in control flow
  scanNestedStatements(stmt, (s) => scanStatementForInterruptHandler(s, handlersByPin, diagnostics));
}

/**
 * Scan the program for unsafe operations inside ISR callbacks.
 */
function scanForUnsafeOperations(
  program: ProgramIR,
  diagnostics: Diagnostic[],
  unsafeOps: Map<string, IsrUnsafeOp>,
): void {
  // Scan callback expressions that are interrupt handlers
  scanProgramForCallbacks(program, (callback, parentExpr) => {
    // Check if this callback is an interrupt handler
    // It's an ISR if it's an arg to attachInterrupt or has interruptMode on parent
    const isISR = isInterruptHandlerCallback(callback, parentExpr);

    if (isISR && callback.statements) {
      for (const stmt of callback.statements) {
        scanStatementForUnsafeOps(stmt, diagnostics, unsafeOps);
      }
    }
  });
}

/**
 * Check if a callback is an interrupt handler.
 */
function isInterruptHandlerCallback(callback: any, parentExpr: any): boolean {
  // Check explicit flag
  if (callback.isInterruptHandler) return true;

  return false;
}

/**
 * Scan a statement for unsafe ISR operations.
 */
function scanStatementForUnsafeOps(
  stmt: StatementIR,
  diagnostics: Diagnostic[],
  unsafeOps: Map<string, IsrUnsafeOp>,
): void {
  if (!stmt || typeof stmt !== 'object') return;

  // Check for call statements
  if (stmt.kind === 'call') {
    const call = stmt as any;
    checkCalleeForUnsafeOp(call.callee, diagnostics, unsafeOps);
  }

  // Recursively scan nested statements
  scanNestedStatements(stmt, (s) => scanStatementForUnsafeOps(s, diagnostics, unsafeOps));
}

/**
 * Check if a callee is an unsafe operation and generate diagnostic.
 */
function checkCalleeForUnsafeOp(callee: string, diagnostics: Diagnostic[], unsafeOps: Map<string, IsrUnsafeOp>): void {
  if (!callee) return;

  // Check direct matches
  const unsafe = unsafeOps.get(callee);
  if (unsafe) {
    diagnostics.push({
      severity: unsafe.severity,
      message: `${callee}() ${unsafe.reason}`,
      code: 'interrupt-unsafe-operation',
      source: 'interrupt-analysis',
    });
    return;
  }

  // Check prefix matches (e.g., I2C0.write matches I2C0)
  for (const [prefix, info] of unsafeOps) {
    if (callee.startsWith(prefix + '.') || callee.startsWith(prefix + ':')) {
      diagnostics.push({
        severity: info.severity,
        message: `${callee} - ${info.reason}`,
        code: 'interrupt-unsafe-operation',
        source: 'interrupt-analysis',
      });
      return;
    }
  }
}

/**
 * Helper to scan nested statements in control flow structures.
 * Exported for reuse by other diagnostic passes.
 */
export function scanNestedStatements(stmt: any, visitor: (s: StatementIR) => void): void {
  if (!stmt) return;

  // if statement
  if (stmt.thenBranch) {
    for (const s of stmt.thenBranch) visitor(s);
  }
  if (stmt.elseBranch) {
    for (const s of stmt.elseBranch) visitor(s);
  }

  // loops
  if (stmt.body && Array.isArray(stmt.body)) {
    for (const s of stmt.body) visitor(s);
  }

  // for loop
  if (stmt.initializer) visitor(stmt.initializer);
  if (stmt.increment) visitor(stmt.increment);

  // switch cases
  if (stmt.cases && Array.isArray(stmt.cases)) {
    for (const c of stmt.cases) {
      if (c.body && Array.isArray(c.body)) {
        for (const s of c.body) visitor(s);
      }
    }
  }

  // try/catch
  if (stmt.tryBlock && Array.isArray(stmt.tryBlock)) {
    for (const s of stmt.tryBlock) visitor(s);
  }
  if (stmt.catchBlock && Array.isArray(stmt.catchBlock)) {
    for (const s of stmt.catchBlock) visitor(s);
  }
}

/**
 * Helper to scan program for callback expressions.
 */
function scanProgramForCallbacks(
  program: ProgramIR,
  callback: (cb: any, parentExpr: any) => void,
): void {
  // Scan top-level statements
  if (program.topLevelStatements) {
    for (const stmt of program.topLevelStatements) {
      scanStatementForCallbacks(stmt, callback, null);
    }
  }

  // Scan functions
  if (program.functions) {
    for (const fn of program.functions) {
      if (fn.statements) {
        for (const stmt of fn.statements) {
          scanStatementForCallbacks(stmt, callback, null);
        }
      }
    }
  }

  // Scan registered callbacks from HAL resolver (callback() directive)
  for (const rc of registeredCallbacks) {
    callback(rc.callbackIR, null);
  }
}

/**
 * Scan a statement for callback expressions.
 */
function scanStatementForCallbacks(
  stmt: any,
  callback: (cb: any, parentExpr: any) => void,
  parentExpr: any,
): void {
  if (!stmt || typeof stmt !== 'object') return;

  // Check call args for callbacks
  if (stmt.kind === 'call' && stmt.args) {
    for (const arg of stmt.args) {
      if (arg && arg.kind === 'callback') {
        callback(arg, stmt);
      }
      scanExpressionForCallbacks(arg, callback, stmt);
    }
  }

  // Check var_decl initializer
  if (stmt.kind === 'var_decl' && stmt.initializer) {
    scanExpressionForCallbacks(stmt.initializer, callback, stmt);
  }

  // Check assignment value
  if (stmt.kind === 'assign' && stmt.value) {
    scanExpressionForCallbacks(stmt.value, callback, stmt);
  }

  // Recursively scan nested statements
  scanNestedStatements(stmt, (s) => scanStatementForCallbacks(s, callback, parentExpr));
}

/**
 * Scan an expression for callback expressions.
 */
function scanExpressionForCallbacks(
  expr: any,
  callback: (cb: any, parentExpr: any) => void,
  parentExpr: any,
): void {
  if (!expr || typeof expr !== 'object') return;

  // Check if this is a callback
  if (expr.kind === 'callback') {
    callback(expr, parentExpr);
  }

  // Check nested expressions
  if (expr.args && Array.isArray(expr.args)) {
    for (const arg of expr.args) {
      scanExpressionForCallbacks(arg, callback, expr);
    }
  }

  if (expr.left) scanExpressionForCallbacks(expr.left, callback, expr);
  if (expr.right) scanExpressionForCallbacks(expr.right, callback, expr);
  if (expr.operand) scanExpressionForCallbacks(expr.operand, callback, expr);
  if (expr.condition) scanExpressionForCallbacks(expr.condition, callback, expr);
  if (expr.consequent) scanExpressionForCallbacks(expr.consequent, callback, expr);
  if (expr.alternate) scanExpressionForCallbacks(expr.alternate, callback, expr);
  if (expr.object) scanExpressionForCallbacks(expr.object, callback, expr);
  if (expr.value) scanExpressionForCallbacks(expr.value, callback, expr);
}
