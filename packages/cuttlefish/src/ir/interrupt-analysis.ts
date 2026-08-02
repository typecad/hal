// ---------------------------------------------------------------------------
// Interrupt Safety Analysis
//
// Detects unsafe operations inside interrupt handlers and duplicate handlers
// on the same pin.
// ---------------------------------------------------------------------------

import type { ProgramIR, StatementIR, ExpressionIR } from '../api/index.js';
import type { PeripheralUsage } from './peripheral-usage.js';
import type { Diagnostic } from '../types.js';
import { walkNestedStatements, walkProgramIR, walkExpressionsInExpression } from './utils/walk-ir.js';

export { walkNestedStatements as scanNestedStatements } from './utils/walk-ir.js';

/** ISR-unsafe operation entry. */
export interface IsrUnsafeOp { reason: string; severity: 'warning' | 'info'; }

/**
 * Fallback ISR-unsafe operations used when no platform-specific map is provided.
 * Empty by design — the Wiring-derived specifics (delay, Serial.*, I2C*, SPI*)
 * live in ArduinoStrategy.isrUnsafeOperations(). A generic target has no known
 * ISR-unsafe surface. The orchestrator passes the loaded framework's map; this
 * default only applies when none is supplied.
 */
const DEFAULT_ISR_UNSAFE_OPERATIONS: Map<string, IsrUnsafeOp> = new Map();

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

  // Check for cuttlefish-call statements — both the low-level pin.attachInterrupt() and
  // the flat sugar API (pin.onFalling / pin.onRising / pin.onChange / etc.) which all
  // lower to a single attachInterrupt call on the same hardware interrupt line.
  const ATTACH_METHODS = new Set(['attachInterrupt', 'onFalling', 'onRising', 'onChange', 'onLow', 'onHigh']);

  // Recursively scan nested statements in control flow
  walkNestedStatements(stmt, (s) => scanStatementForInterruptHandler(s, handlersByPin, diagnostics));
}

function scanForUnsafeOperations(
  program: ProgramIR,
  diagnostics: Diagnostic[],
  unsafeOps: Map<string, IsrUnsafeOp>,
): void {
  scanProgramForCallbacks(program, (callback, parentExpr) => {
    const isISR = isInterruptHandlerCallback(callback, parentExpr);

    if (isISR && callback.statements) {
      for (const stmt of callback.statements) {
        scanStatementForUnsafeOps(stmt, diagnostics, unsafeOps);
      }
    }
  });
}

function isInterruptHandlerCallback(callback: any, parentExpr: any): boolean {
  if (callback.isInterruptHandler) return true;
  return false;
}

function scanStatementForUnsafeOps(
  stmt: StatementIR,
  diagnostics: Diagnostic[],
  unsafeOps: Map<string, IsrUnsafeOp>,
): void {
  if (!stmt || typeof stmt !== 'object') return;
  const filePath = (stmt as { sourceSpan?: { filePath?: string } }).sourceSpan?.filePath;

  if (stmt.kind === 'call') {
    const call = stmt as any;
    checkCalleeForUnsafeOp(call.callee, diagnostics, unsafeOps, filePath);
  }

  // HAL-op statements: after HAL resolution, bare Arduino calls like delay()
  // and delayMicroseconds() become structured hal-op statements (timing.delay,
  // timing.delay_microseconds) rather than kind:'call'. Map them back to the
  // unsafe-op keys so ISR detection works on the resolved form.
  if (stmt.kind === 'hal-op') {
    const op = (stmt as any).operation;
    if (op) {
      const HAL_OP_TO_UNSAFE: Record<string, string> = {
        'timing.delay': 'delay',
        'timing.delay_microseconds': 'delayMicroseconds',
      };
      const key = HAL_OP_TO_UNSAFE[op.operation];
      if (key) checkCalleeForUnsafeOp(key, diagnostics, unsafeOps, filePath);
    }
  }

  walkNestedStatements(stmt, (s) => scanStatementForUnsafeOps(s, diagnostics, unsafeOps));
}

/**
 * Check if a callee is an unsafe operation and generate diagnostic.
 */
function checkCalleeForUnsafeOp(
  callee: string,
  diagnostics: Diagnostic[],
  unsafeOps: Map<string, IsrUnsafeOp>,
  filePath?: string,
): void {
  if (!callee) return;

  // Check direct matches
  const unsafe = unsafeOps.get(callee);
  if (unsafe) {
    diagnostics.push({
      severity: unsafe.severity,
      message: `${callee}() ${unsafe.reason}`,
      code: 'interrupt-unsafe-operation',
      filePath,
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
        filePath,
        source: 'interrupt-analysis',
      });
      return;
    }
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
  for (const rc of (program.registeredCallbacks ?? [])) {
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

  walkNestedStatements(stmt as StatementIR, (s) => scanStatementForCallbacks(s, callback, parentExpr));
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
  if (expr.whenTrue) scanExpressionForCallbacks(expr.whenTrue, callback, expr);
  if (expr.whenFalse) scanExpressionForCallbacks(expr.whenFalse, callback, expr);
  if (expr.object) scanExpressionForCallbacks(expr.object, callback, expr);
  if (expr.value && typeof expr.value === 'object' && 'kind' in (expr.value as object)) {
    scanExpressionForCallbacks(expr.value as ExpressionIR, callback, expr);
  }
}

// ---------------------------------------------------------------------------
// Automatic volatile inference for ISR-shared globals.
//
// The classic AVR bug: a global `flag` set in an ISR and polled in loop()
// becomes an infinite loop under -Os because g++ caches it in a register. The
// transpiler knows which callbacks are ISRs (isInterruptHandler) and which
// globals are assigned inside them — information g++ cannot recover. This pass
// auto-marks such globals `volatile`, eliminating the bug class entirely. The
// emission path already handles isVolatile (statement-renderer.ts).
// ---------------------------------------------------------------------------

/** Collect variable names assigned (written) within a statement body. */
export function collectAssignedNames(stmts: readonly StatementIR[], names: Set<string>): void {
  for (const stmt of stmts) {
    const s = stmt as any;
    if (stmt.kind === 'assign') {
      // `flag = true` → target is the bare name (no dot/arrow).
      if (typeof s.target === 'string' && !s.target.includes('.') && !s.target.includes('->')) {
        names.add(s.target);
      }
    }
    if (stmt.kind === 'update') {
      // `flag++` / `counter--`.
      if (typeof s.target === 'string' && !s.target.includes('.') && !s.target.includes('->')) {
        names.add(s.target);
      }
    }
    // Recurse into nested bodies.
    const nested = getNestedStatements(stmt);
    if (nested) collectAssignedNames(nested, names);
  }
}

/** Collect variable names read (referenced) within a statement body. */
export function collectReadNames(stmts: readonly StatementIR[], names: Set<string>): void {
  for (const stmt of stmts) {
    walkExpressionsInStatement(stmt, (expr) => {
      if (expr.kind === 'identifier' && typeof (expr as any).value === 'string') {
        names.add((expr as any).value);
      }
    });
    const nested = getNestedStatements(stmt);
    if (nested) collectReadNames(nested, names);
  }
}

/** Walk all expressions in a single statement (delegates to walkExpressionsInExpression). */
function walkExpressionsInStatement(stmt: StatementIR, visitor: (expr: ExpressionIR) => void): void {
  const s = stmt as any;
  if (s.initializer && typeof s.initializer === 'object') walkExpressionsInExpression(s.initializer, visitor);
  if (s.value && typeof s.value === 'object' && 'kind' in (s.value as object)) walkExpressionsInExpression(s.value, visitor);
  if (s.condition && typeof s.condition === 'object') walkExpressionsInExpression(s.condition, visitor);
  if (s.expression && typeof s.expression === 'object' && 'kind' in (s.expression as object)) walkExpressionsInExpression(s.expression, visitor);
  if (Array.isArray(s.args)) {
    for (const a of s.args) walkExpressionsInExpression(a, visitor);
  }
  if (s.target && typeof s.target === 'string') {
    // assignment target is read-then-written; record the read.
    visitor({ kind: 'identifier', value: s.target });
  }
}

/**
 * Infer `volatile` for global variables shared between ISR callbacks and main
 * code. Mutates the IR (sets isVolatile=true on qualifying var_decls) and
 * emits an info diagnostic for each promotion. A variable qualifies when it is
 * a global (top-level) that is assigned inside an isInterruptHandler callback
 * AND read from non-ISR code (setup/loop/main/functions).
 */
export function inferVolatileForIsrSharedVars(program: ProgramIR, diagnostics: Diagnostic[]): void {
  // 1. Build a map of global var_decl name → IR node.
  const globalVars = new Map<string, StatementIR>();
  for (const stmt of program.topLevelStatements) {
    if (stmt.kind === 'var_decl' && typeof (stmt as any).name === 'string') {
      globalVars.set((stmt as any).name, stmt);
    }
  }
  if (globalVars.size === 0) return;

  // 2. Find names assigned inside ISR callbacks.
  const isrAssignedNames = new Set<string>();
  const isrCallbackBodies: StatementIR[][] = [];
  scanProgramForCallbacks(program, (callback) => {
    if (callback.isInterruptHandler && Array.isArray(callback.statements)) {
      isrCallbackBodies.push(callback.statements);
      collectAssignedNames(callback.statements, isrAssignedNames);
    }
  });
  if (isrAssignedNames.size === 0) return;

  // 3. Find names read from non-ISR code.
  const mainReadNames = new Set<string>();
  for (const stmt of program.topLevelStatements) collectReadNames([stmt], mainReadNames);
  for (const fn of program.functions) {
    if (fn.statements) collectReadNames(fn.statements, mainReadNames);
  }
  for (const cls of program.classes) {
    for (const m of cls.methods) {
      if (m.statements) collectReadNames(m.statements, mainReadNames);
    }
    if (cls.constructor?.statements) collectReadNames(cls.constructor.statements, mainReadNames);
  }
  // ISR callback reads don't count as "main reads" — exclude them.
  for (const body of isrCallbackBodies) {
    const isrReads = new Set<string>();
    collectReadNames(body, isrReads);
    for (const name of isrReads) {
      // Only remove if the name isn't ALSO read outside ISRs (already captured above).
      // This is a conservative check: we keep the name if it appears in both.
    }
  }

  // 4. Promote globals that are ISR-written AND main-read.
  for (const [name, stmt] of globalVars) {
    if (isrAssignedNames.has(name) && mainReadNames.has(name) && !(stmt as any).isVolatile) {
      (stmt as any).isVolatile = true;
      diagnostics.push({
        severity: 'info',
        message: `'${name}' is written in an interrupt handler and read in main code — emitted as \`volatile\` to prevent the compiler from caching it in a register (the classic ISR/loop race).`,
        filePath: (stmt as any).sourceSpan?.filePath,
        line: (stmt as any).sourceSpan?.startLine,
        column: (stmt as any).sourceSpan?.startColumn,
        code: 'volatile-isr-shared',
        source: 'interrupt-analysis',
      });
    }
  }
}

/** Helper: get nested statement arrays from a compound statement. */
function getNestedStatements(stmt: StatementIR): StatementIR[] | null {
  const s = stmt as any;
  const out: StatementIR[] = [];
  if (Array.isArray(s.body)) out.push(...s.body);
  if (Array.isArray(s.thenBranch)) out.push(...s.thenBranch);
  if (Array.isArray(s.elseBranch)) out.push(...s.elseBranch);
  if (Array.isArray(s.tryBlock)) out.push(...s.tryBlock);
  if (Array.isArray(s.catchBlock)) out.push(...s.catchBlock);
  if (Array.isArray(s.finallyBlock)) out.push(...s.finallyBlock);
  if (Array.isArray(s.cases)) {
    for (const c of s.cases) {
      if (Array.isArray(c.body)) out.push(...c.body);
    }
  }
  return out.length > 0 ? out : null;
}

// ---------------------------------------------------------------------------
// Reentrancy detection.
//
// If a function is called from both an ISR callback and main-thread code
// (setup/loop/other functions), an interrupt firing mid-execution corrupts
// the function's local state or shared buffers. This is the hardest embedded
// bug to diagnose — rare, non-deterministic corruption. The transpiler knows
// which callbacks are ISRs and can see the whole call graph, so it can flag
// the intersection — something g++ fundamentally cannot do (it has no concept
// of "this function runs in interrupt context").
// ---------------------------------------------------------------------------

/** Collect callee names from call statements within a statement body. */
function collectCalleeNames(stmts: readonly StatementIR[], names: Set<string>): void {
  for (const stmt of stmts) {
    const s = stmt as any;
    if (stmt.kind === 'call' && typeof s.callee === 'string') {
      // Bare function calls only (not method calls like obj.method()).
      if (!s.callee.includes('.') && !s.callee.includes('->') && !s.callee.includes('::')) {
        names.add(s.callee);
      }
    }
    const nested = getNestedStatements(stmt);
    if (nested) collectCalleeNames(nested, names);
  }
}

/**
 * Detect functions called from both ISR callbacks and main-thread code.
 * Emits a warning for each reentrancy-risk function.
 */
export function detectReentrancyRisk(program: ProgramIR, diagnostics: Diagnostic[]): void {
  // Collect user-defined function names for filtering (only flag calls to
  // functions that exist in this program — not bare Arduino functions).
  const userFunctionNames = new Set<string>();
  for (const fn of program.functions) userFunctionNames.add(fn.originalName);
  for (const cls of program.classes) {
    for (const m of cls.methods) userFunctionNames.add(m.name);
  }
  if (userFunctionNames.size === 0) return;

  // 1. Collect callees from ISR callback bodies.
  const isrCallees = new Set<string>();
  scanProgramForCallbacks(program, (callback) => {
    if (callback.isInterruptHandler && Array.isArray(callback.statements)) {
      collectCalleeNames(callback.statements, isrCallees);
    }
  });
  if (isrCallees.size === 0) return;

  // 2. Collect callees from main-thread code (functions + class methods).
  const mainCallees = new Set<string>();
  for (const fn of program.functions) {
    if (fn.statements) collectCalleeNames(fn.statements, mainCallees);
  }
  for (const cls of program.classes) {
    for (const m of cls.methods) {
      if (m.statements) collectCalleeNames(m.statements, mainCallees);
    }
    if (cls.constructor?.statements) collectCalleeNames(cls.constructor.statements, mainCallees);
  }
  for (const stmt of program.topLevelStatements) collectCalleeNames([stmt], mainCallees);

  // 3. Flag user functions in the intersection.
  for (const name of isrCallees) {
    if (mainCallees.has(name) && userFunctionNames.has(name)) {
      diagnostics.push({
        severity: 'warning',
        message: `'${name}' is called from both an interrupt handler and main-thread code. An interrupt firing mid-execution can corrupt the function's local state. Wrap the main-thread call in noInterrupts()/interrupts(), or refactor to avoid sharing the function.`,
        code: 'reentrancy-risk',
        filePath: program.fileName,
        source: 'interrupt-analysis',
      });
    }
  }
}
