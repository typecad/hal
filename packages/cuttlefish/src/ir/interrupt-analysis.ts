// ---------------------------------------------------------------------------
// Interrupt Safety Analysis
//
// Detects unsafe operations inside interrupt handlers, duplicate handlers on
// the same pin, ISR/main shared-state races (automatic volatile), and
// ISR/main function reentrancy.
//
// ISR bodies come from two shapes: inline/lambda callbacks registered with
// isInterruptHandler=true on ProgramIR.registeredCallbacks, and free
// functions passed BY NAME as handlers (ProgramIR.isrHandlerFunctions — a
// named handler lowers to a bare C function reference and carries no callback
// IR node, so its body is only reachable through program.functions).
// ---------------------------------------------------------------------------

import type { ProgramIR, StatementIR, ExpressionIR } from '../api/index.js';
import type { Diagnostic } from '../types.js';
import { walkNestedStatements, walkExpressionsInExpression } from './utils/walk-ir.js';

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
 * HAL-op operations whose unsafe-ness is named by the operation itself, mapped
 * to the strategy-map key with the matching reason. After HAL resolution an
 * ISR body holds structured hal-op statements, not `call` statements — the
 * strategy keys (delay, I2C0, UART0, …) are callee-shaped and would never
 * match without this mapping.
 */
const HAL_OP_TO_UNSAFE: Record<string, string> = {
  'timing.delay': 'delay',
  'timing.delay_microseconds': 'delayMicroseconds',
  // Time.sleep lowers to k_msleep — the same sleeps-the-thread violation the
  // 'delay' key describes. Time.busyWaitUs spin-waits the CPU for its full
  // duration — same stall as delayMicroseconds.
  'timing.sleep': 'delay',
  'timing.busy_wait_us': 'delayMicroseconds',
};

/**
 * HAL-op payload fields whose string value is the peripheral identity the
 * strategy map keys on (uart.poll_write carries port: "UART0"; the i2c and
 * spi ops carry bus: "I2C0"/"SPI0"). Values are matched against the map
 * directly, so no per-op-name table is needed — a framework that adds a key
 * for a new bus instance is picked up from the op payload alone.
 */
const HAL_OP_IDENTITY_FIELDS = ['port', 'bus'] as const;

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
  usage: unknown,
  isrUnsafeOps?: Map<string, IsrUnsafeOp>,
): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const unsafeOps = isrUnsafeOps ?? DEFAULT_ISR_UNSAFE_OPERATIONS;

  scanForDuplicateHandlers(program, diagnostics);
  scanForUnsafeOperations(program, diagnostics, unsafeOps);

  return diagnostics;
}

// ---------------------------------------------------------------------------
// ISR body collection
// ---------------------------------------------------------------------------

/** Statement bodies of every ISR in the program (inline callbacks + named handler functions). */
function collectIsrBodies(program: ProgramIR): StatementIR[][] {
  const bodies: StatementIR[][] = [];
  for (const rc of program.registeredCallbacks ?? []) {
    const cb = rc.callbackIR as { isInterruptHandler?: boolean; statements?: StatementIR[] };
    if (cb?.isInterruptHandler && Array.isArray(cb.statements)) {
      bodies.push(cb.statements);
    }
  }
  const handlerNames = new Set(program.isrHandlerFunctions ?? []);
  if (handlerNames.size > 0) {
    for (const fn of program.functions) {
      if (handlerNames.has(fn.originalName) && Array.isArray(fn.statements)) {
        bodies.push(fn.statements);
      }
    }
  }
  return bodies;
}

/** Names of user functions used as interrupt handlers (named-handler form). */
function isrHandlerFunctionNames(program: ProgramIR): Set<string> {
  return new Set(program.isrHandlerFunctions ?? []);
}

// ---------------------------------------------------------------------------
// Duplicate handler detection
// ---------------------------------------------------------------------------

/** Recurse over a statement list, invoking the visitor on every statement including nested ones. */
function visitAllStatements(stmts: readonly StatementIR[], visitor: (s: StatementIR) => void): void {
  for (const stmt of stmts) {
    visitor(stmt);
    walkNestedStatements(stmt, (s) => visitAllStatements([s], visitor));
  }
}

/** Every statement list in the program that can hold an interrupt attach. */
function allProgramBodies(program: ProgramIR): StatementIR[][] {
  const bodies: StatementIR[][] = [...collectIsrBodies(program)];
  bodies.push(program.topLevelStatements);
  for (const fn of program.functions) {
    if (Array.isArray(fn.statements)) bodies.push(fn.statements);
  }
  for (const cls of program.classes) {
    if (cls.constructor?.statements) bodies.push(cls.constructor.statements);
    for (const m of cls.methods) {
      if (m.statements) bodies.push(m.statements);
    }
  }
  return bodies;
}

/**
 * Flag pins with more than one live interrupt handler. A second attach on the
 * same pin silently replaces the earlier handler (the lowering overwrites the
 * trampoline's handler pointer). A detach between attaches is the legit
 * re-attach pattern, so the warning fires only when attaches outnumber
 * detaches by more than one.
 */
function scanForDuplicateHandlers(program: ProgramIR, diagnostics: Diagnostic[]): void {
  const attaches = new Map<number, number>();
  const detaches = new Map<number, number>();

  for (const body of allProgramBodies(program)) {
    visitAllStatements(body, (stmt) => {
      if (stmt.kind !== 'hal-op') return;
      const op = (stmt as { operation?: { operation?: string; pin?: unknown } }).operation;
      if (!op || typeof op.pin !== 'number') return;
      if (op.operation === 'interrupt.attach_flags') {
        attaches.set(op.pin, (attaches.get(op.pin) ?? 0) + 1);
      } else if (op.operation === 'interrupt.detach') {
        detaches.set(op.pin, (detaches.get(op.pin) ?? 0) + 1);
      }
    });
  }

  for (const [pin, count] of attaches) {
    if (count - (detaches.get(pin) ?? 0) > 1) {
      diagnostics.push({
        severity: 'warning',
        message: `pin ${pin} has ${count} interrupt attaches — each attach replaces the previous handler, so only the last one runs (add offInterrupt()/detach between attaches if replacement is intended).`,
        code: 'interrupt-duplicate-handler',
        filePath: program.fileName,
        source: 'interrupt-analysis',
      });
    }
  }
}

// ---------------------------------------------------------------------------
// ISR-unsafe operation detection
// ---------------------------------------------------------------------------

function scanForUnsafeOperations(
  program: ProgramIR,
  diagnostics: Diagnostic[],
  unsafeOps: Map<string, IsrUnsafeOp>,
): void {
  if (unsafeOps.size === 0) return;

  // Bare user-function calls reachable from an ISR run in interrupt context
  // too, so their bodies are scanned with the same rules. The visited set
  // guards recursion and prevents double-reporting shared helpers.
  const userFnBodies = new Map<string, StatementIR[]>();
  for (const fn of program.functions) {
    if (Array.isArray(fn.statements)) userFnBodies.set(fn.originalName, fn.statements);
  }

  const seen = new Set<string>();
  for (const body of collectIsrBodies(program)) {
    scanBodyForUnsafeOps(body, diagnostics, unsafeOps, userFnBodies, new Set([body]), seen);
  }
}

function scanBodyForUnsafeOps(
  stmts: readonly StatementIR[],
  diagnostics: Diagnostic[],
  unsafeOps: Map<string, IsrUnsafeOp>,
  userFnBodies: Map<string, StatementIR[]>,
  visited: Set<readonly StatementIR[]>,
  seen: Set<string>,
): void {
  for (const stmt of stmts) {
    scanStatementForUnsafeOps(stmt, diagnostics, unsafeOps, userFnBodies, visited, seen);
  }
}

function scanStatementForUnsafeOps(
  stmt: StatementIR,
  diagnostics: Diagnostic[],
  unsafeOps: Map<string, IsrUnsafeOp>,
  userFnBodies: Map<string, StatementIR[]>,
  visited: Set<readonly StatementIR[]>,
  seen: Set<string>,
): void {
  if (!stmt || typeof stmt !== 'object') return;
  const loc = statementLoc(stmt);

  if (stmt.kind === 'call') {
    const call = stmt as { callee?: unknown };
    const callee = typeof call.callee === 'string' ? call.callee : undefined;
    if (callee) {
      checkCalleeForUnsafeOp(callee, diagnostics, unsafeOps, loc, seen);
      // Follow bare calls into user functions (not obj.method()/fn() in
      // namespaces): whatever they execute runs in interrupt context.
      const isBareName = !callee.includes('.') && !callee.includes('->') && !callee.includes('::');
      const body = isBareName ? userFnBodies.get(callee) : undefined;
      if (body && !visited.has(body)) {
        visited.add(body);
        scanBodyForUnsafeOps(body, diagnostics, unsafeOps, userFnBodies, visited, seen);
      }
    }
  }

  // HAL-op statements: after HAL resolution, ISR bodies hold structured
  // hal-op statements (timing.sleep, uart.poll_write, i2c.reg_write, …)
  // rather than kind:'call'. Map each op back to the strategy's unsafe-op
  // keys — by operation name (timing.*) and by peripheral identity carried
  // in the payload (port: "UART0", bus: "I2C0").
  if (stmt.kind === 'hal-op') {
    const op = (stmt as { operation?: unknown }).operation;
    for (const key of halOpUnsafeKeys(op)) {
      checkCalleeForUnsafeOp(key, diagnostics, unsafeOps, loc, seen, /* viaOp */ true);
    }
  }

  walkNestedStatements(stmt, (s) => scanStatementForUnsafeOps(s, diagnostics, unsafeOps, userFnBodies, visited, seen));
}

/** File/line/column of the statement an unsafe use sits on — the deduped
 *  diagnostic reports the FIRST occurrence, so it needs to point somewhere. */
function statementLoc(stmt: StatementIR): { filePath?: string; line?: number; column?: number } {
  const span = (stmt as { sourceSpan?: { filePath?: string; startLine?: number; startColumn?: number } }).sourceSpan;
  return {
    filePath: span?.filePath,
    line: span?.startLine,
    column: span?.startColumn,
  };
}

/** Strategy-map keys an op's payload matches: operation-name mapping + identity fields. */
function halOpUnsafeKeys(op: unknown): string[] {
  if (!op || typeof op !== 'object') return [];
  const keys: string[] = [];
  const mapped = HAL_OP_TO_UNSAFE[(op as { operation?: string }).operation ?? ''];
  if (mapped) keys.push(mapped);
  const record = op as Record<string, unknown>;
  for (const field of HAL_OP_IDENTITY_FIELDS) {
    const v = record[field];
    if (typeof v === 'string' && v) keys.push(v);
  }
  return keys;
}

/**
 * Check a key against the unsafe-op map (direct, then `key.`-prefixed callees
 * like `I2C0.write` matching the `I2C0` entry) and push a diagnostic.
 * Deduplicated per key so a helper called from two ISR paths reports once.
 * `viaOp` switches to the prefix-style message: op-derived keys are bare
 * peripheral names ("UART0", "delay"), and the strategy reason strings read
 * naturally attached with a dash.
 */
function checkCalleeForUnsafeOp(
  callee: string,
  diagnostics: Diagnostic[],
  unsafeOps: Map<string, IsrUnsafeOp>,
  loc?: { filePath?: string; line?: number; column?: number },
  seen?: Set<string>,
  viaOp: boolean = false,
): void {
  if (!callee) return;

  const report = (message: string, severity: 'warning' | 'info'): void => {
    const dedupeKey = `${callee}|${severity}`;
    if (seen) {
      if (seen.has(dedupeKey)) return;
      seen.add(dedupeKey);
    }
    diagnostics.push({
      severity,
      message,
      code: 'interrupt-unsafe-operation',
      filePath: loc?.filePath,
      ...(loc?.line !== undefined ? { line: loc.line } : {}),
      ...(loc?.column !== undefined ? { column: loc.column } : {}),
      source: 'interrupt-analysis',
    });
  };

  // Direct match
  const unsafe = unsafeOps.get(callee);
  if (unsafe) {
    report(viaOp ? `${callee} - ${unsafe.reason}` : `${callee}() ${unsafe.reason}`, unsafe.severity);
    return;
  }

  // Prefix matches (e.g., I2C0.write matches I2C0)
  for (const [prefix, info] of unsafeOps) {
    if (callee.startsWith(prefix + '.') || callee.startsWith(prefix + ':')) {
      report(`${callee} - ${info.reason}`, info.severity);
      return;
    }
  }
}

// ---------------------------------------------------------------------------
// Automatic volatile inference for ISR-shared globals.
//
// The classic AVR bug: a global `flag` set in an ISR and polled in loop()
// becomes an infinite loop under -Os because g++ caches it in a register. The
// transpiler knows which callbacks are ISRs (isInterruptHandler / named
// handlers) and which globals are assigned inside them — information g++
// cannot recover. This pass auto-marks such globals `volatile`, eliminating
// the bug class entirely. The emission path already handles isVolatile
// (statement-renderer.ts).
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
  // hal-op payloads carry expression args too (e.g. a uart.write of a runtime
  // value). The C fragments fused at build time are strings — unreachable
  // here; inferVolatileForIsrSharedVars scans those separately.
  if (s.operation && typeof s.operation === 'object') {
    for (const v of Object.values(s.operation)) {
      if (Array.isArray(v)) {
        for (const item of v) {
          if (item && typeof item === 'object' && 'kind' in (item as object)) {
            walkExpressionsInExpression(item as ExpressionIR, visitor);
          }
        }
      } else if (v && typeof v === 'object' && 'kind' in (v as object)) {
        walkExpressionsInExpression(v as ExpressionIR, visitor);
      }
    }
  }
}

/**
 * Collect the C fragments the build fused into __EMIT__ call statements.
 * `UART0.writeLine("irq=" + irq)` lowers to a snprintf fragment whose
 * identifier references exist ONLY as text inside these strings — the
 * expression IR is gone by validation time.
 */
function collectEmittedFragments(stmt: StatementIR, out: string[]): void {
  const s = stmt as any;
  if (stmt.kind === 'call' && s.callee === '__EMIT__' && Array.isArray(s.args)) {
    for (const a of s.args) {
      if (a && a.kind === 'string' && typeof a.value === 'string') out.push(a.value);
    }
  }
  walkNestedStatements(stmt, (n) => collectEmittedFragments(n, out));
}

/** Blank out C string/char literals so only emitted CODE text is matched. */
function stripCStringLiterals(text: string): string {
  return text.replace(/"(?:[^"\\]|\\.)*"/g, '""').replace(/'(?:[^'\\]|\\.)*'/g, "''");
}

function escapeRegExp(name: string): string {
  return name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Infer `volatile` for global variables shared between ISR callbacks and main
 * code. Mutates the IR (sets isVolatile=true on qualifying var_decls) and
 * emits an info diagnostic for each promotion. A variable qualifies when it is
 * a global (top-level) that is assigned inside an ISR body AND read from
 * non-ISR code (setup/loop/main/functions/class methods — including reads the
 * build fused into emitted formatting fragments).
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

  // 2. Find names assigned inside ISR bodies.
  const isrAssignedNames = new Set<string>();
  for (const body of collectIsrBodies(program)) {
    collectAssignedNames(body, isrAssignedNames);
  }
  if (isrAssignedNames.size === 0) return;

  // 3. Find names read from non-ISR code. Handler functions ARE ISR bodies —
  // their own reads must not count as main reads.
  const handlerNames = isrHandlerFunctionNames(program);
  const mainBodies: StatementIR[][] = [program.topLevelStatements];
  for (const fn of program.functions) {
    if (handlerNames.has(fn.originalName) || !Array.isArray(fn.statements)) continue;
    mainBodies.push(fn.statements);
  }
  for (const cls of program.classes) {
    if (cls.constructor?.statements) mainBodies.push(cls.constructor.statements);
    for (const m of cls.methods) {
      if (m.statements) mainBodies.push(m.statements);
    }
  }

  const mainReadNames = new Set<string>();
  for (const body of mainBodies) collectReadNames(body, mainReadNames);

  // 3b. Reads fused into emitted formatting fragments are invisible to the
  // expression walk — recover them from the C fragment text. C string
  // literals are blanked out first so a user label like writeLine("irq")
  // does not read as a variable reference; only code identifiers match.
  const unfound = [...isrAssignedNames].filter((name) => !mainReadNames.has(name) && globalVars.has(name));
  if (unfound.length > 0) {
    const fragments: string[] = [];
    for (const body of mainBodies) collectEmittedFragmentsFrom(body, fragments);
    if (fragments.length > 0) {
      for (const fragment of fragments) {
        const code = stripCStringLiterals(fragment);
        for (const name of unfound) {
          if (new RegExp(`\\b${escapeRegExp(name)}\\b`).test(code)) mainReadNames.add(name);
        }
      }
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

/** collectEmittedFragments over a statement list (convenience form). */
function collectEmittedFragmentsFrom(stmts: readonly StatementIR[], out: string[]): void {
  for (const stmt of stmts) collectEmittedFragments(stmt, out);
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
 * Detect functions called from both ISR callbacks and main-thread code, and
 * named handler functions also invoked from main-thread code.
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

  // 1. Collect callees from ISR bodies (inline callbacks + named handlers).
  const isrCallees = new Set<string>();
  for (const body of collectIsrBodies(program)) {
    collectCalleeNames(body, isrCallees);
  }

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

  // 4. A named handler invoked from main thread is itself the reentrancy
  // risk: the interrupt can fire mid-execution of the main-thread call.
  for (const name of isrHandlerFunctionNames(program)) {
    if (mainCallees.has(name)) {
      diagnostics.push({
        severity: 'warning',
        message: `'${name}' is an interrupt handler and is also called from main-thread code. An interrupt firing mid-execution of the main-thread call can corrupt the handler's local state. Wrap the main-thread call in noInterrupts()/interrupts(), or refactor the shared logic into a separate function.`,
        code: 'reentrancy-risk',
        filePath: program.fileName,
        source: 'interrupt-analysis',
      });
    }
  }
}
