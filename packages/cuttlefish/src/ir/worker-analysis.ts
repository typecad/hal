// ---------------------------------------------------------------------------
// Worker Isolation Analysis (Phase 1/2)
//
// Models the safety property of the generalized worker-offload feature: worker
// functions run on a separate thread of control (a FreeRTOS task / Zephyr
// workqueue thread), so any shared mutable state between a worker and the main
// loop() is a real data race that the cooperative model otherwise eliminates.
//
// This pass mirrors interrupt-analysis.ts but splits the verdict by the surface
// a worker shares with main:
//
//   (a) Shared GLOBALS — the worker writes a global the main loop reads (or
//       both write it). The worker can run on a different core, so:
//         - worker-written + main-read  → promote to volatile + info diagnostic
//           (mirrors the ISR volatile pass; the barrier contract makes the
//           write visible, volatile stops the compiler caching the read).
//         - worker-written + main-written (mutated by both) → warning:
//           a true data race the barrier alone cannot fix.
//
//   (b) Shared BUSES (I2C/SPI/UART/Wire/Serial) — a worker touching a bus is a
//       HARD ERROR in v1. Rationale: the existing take()/release() bus-ownership
//       mechanism is statically enforced (peripheral-ownership.ts) but runtime-
//       UNIMPLEMENTED (take() is a no-op). A bus is a protocol-level conflict
//       (two masters on the wire), so leaning on a lock that isn't there would
//       be unsound. Workers are compute/pure-only in v1. When the take/release
//       runtime backend lands (the named follow-on), this tier flips from
//       error → allowed-by-take/release.
//
// Worker function identification: a worker function is one referenced by a
// worker.submit HAL op (expr.operation.operation === 'worker.submit'). The op
// carries fnRef (the C++ symbol), which we correlate to a program function by
// name. This mirrors how interrupt-analysis identifies ISRs via
// isInterruptHandler, but resolves through the HAL op instead of a callback
// flag (worker functions are plain functions, not callbacks).
// ---------------------------------------------------------------------------

import type { ProgramIR, StatementIR, ExpressionIR } from '../api/index.js';
import type { Diagnostic } from '../types.js';
import { collectAssignedNames, collectReadNames } from './interrupt-analysis.js';
import { walkNestedStatements, walkProgramIR } from './utils/walk-ir.js';

// Bus-object prefixes a worker is forbidden from touching in v1. Mirrors the
// getBusName regex in peripheral-ownership.ts (I2C/SPI/UART/Wire/Serial).
const BUS_PREFIXES = ['I2C', 'SPI', 'UART', 'Wire', 'Serial'];

/** True if an identifier/callee string names a bus object (forbidden in workers). */
function isBusName(name: string): boolean {
  // Wire / Serial exactly, or I2C<n> / SPI<n> / UART<n> / Serial<n>.
  if (name === 'Wire' || name === 'Serial') return true;
  for (const p of ['I2C', 'SPI', 'UART']) {
    if (new RegExp(`^${p}\\d`).test(name)) return true;
  }
  if (/^Serial\d/.test(name)) return true;
  return false;
}

/**
 * Walk every expression in the program, invoking the visitor for worker.submit
 * HAL ops. HAL ops appear as expressions whose `.operation.operation` is the
 * op-kind string (mirrors the scan in program-analysis.ts:348).
 */
function scanForWorkerSubmitOps(
  program: ProgramIR,
  visit: (fnRef: string, span: any) => void,
): void {
  walkProgramIR(program, (stmt) => {
    walkExpressionsInStatementLocal(stmt, (expr: any) => {
      if (expr && typeof expr === 'object'
          && expr.operation && typeof expr.operation === 'object'
          && expr.operation.operation === 'worker.submit') {
        const fnRef = expr.operation.fnRef;
        if (typeof fnRef === 'string') visit(fnRef, expr.sourceSpan ?? expr.operation.sourceSpan);
      }
    });
  });
}

/** Collect the set of bus object names referenced (read/called) in a body. */
function collectBusAccesses(stmts: readonly StatementIR[], hits: { name: string; span: any }[]): void {
  for (const stmt of stmts) {
    collectBusAccessesInStatement(stmt, hits);
    const nested = getNestedStatements(stmt);
    if (nested) collectBusAccesses(nested, hits);
  }
}

function collectBusAccessesInStatement(stmt: StatementIR, hits: { name: string; span: any }[]): void {
  const s = stmt as any;
  // Method calls like Wire.begin() / I2C0.writeByte(...): callee is "Wire.begin".
  if (s.callee && typeof s.callee === 'string') {
    const base = s.callee.split('.')[0];
    if (isBusName(base)) hits.push({ name: base, span: s.sourceSpan });
  }
  // Identifier references (Wire, Serial, I2C0 used bare).
  const visit = (expr: any) => {
    if (expr && typeof expr === 'object' && expr.kind === 'identifier' && typeof expr.value === 'string') {
      if (isBusName(expr.value)) hits.push({ name: expr.value, span: expr.sourceSpan });
    }
  };
  walkExpressionsInStatementLocal(stmt, visit);
}

function walkExpressionsInStatementLocal(stmt: StatementIR, visitor: (expr: any) => void): void {
  const s = stmt as any;
  if (s.initializer && typeof s.initializer === 'object') walkExpressionsInExpressionLocal(s.initializer, visitor);
  if (s.value && typeof s.value === 'object' && 'kind' in (s.value as object)) walkExpressionsInExpressionLocal(s.value, visitor);
  if (s.condition && typeof s.condition === 'object') walkExpressionsInExpressionLocal(s.condition, visitor);
  if (s.expression && typeof s.expression === 'object' && 'kind' in (s.expression as object)) walkExpressionsInExpressionLocal(s.expression, visitor);
  if (Array.isArray(s.args)) for (const a of s.args) walkExpressionsInExpressionLocal(a, visitor);
  if (s.callee && typeof s.callee === 'object') walkExpressionsInExpressionLocal(s.callee, visitor);
}

function walkExpressionsInExpressionLocal(expr: any, visitor: (expr: any) => void): void {
  if (!expr || typeof expr !== 'object') return;
  visitor(expr);
  for (const k of ['left', 'right', 'object', 'property', 'value', 'condition', 'whenTrue', 'whenFalse', 'expression', 'callee', 'target']) {
    const v = expr[k];
    if (v && typeof v === 'object' && 'kind' in v) walkExpressionsInExpressionLocal(v, visitor);
  }
  if (Array.isArray(expr.args)) for (const a of expr.args) walkExpressionsInExpressionLocal(a, visitor);
  if (Array.isArray(expr.elements)) for (const a of expr.elements) walkExpressionsInExpressionLocal(a, visitor);
}

function getNestedStatements(stmt: StatementIR): StatementIR[] | undefined {
  // Reuse the walk-ir helper if it exposes nesting; otherwise return undefined.
  const s = stmt as any;
  if (Array.isArray(s.body)) return s.body;
  if (Array.isArray(s.statements)) return s.statements;
  if (s.thenBlock && Array.isArray(s.thenBlock.statements)) return s.thenBlock.statements;
  if (s.elseBlock && Array.isArray(s.elseBlock.statements)) return s.elseBlock.statements;
  return undefined;
}

/** Find a function in program.functions by name (or originalName). */
function findFunctionByName(program: ProgramIR, name: string): any | undefined {
  return program.functions.find((fn: any) => fn.name === name || fn.originalName === name);
}

/**
 * Analyze worker isolation: (a) promote volatile for worker-shared globals,
 * (b) flag shared-mutable globals, (c) hard-error on bus access in workers.
 *
 * Mutates the IR for (a) (sets isVolatile=true on qualifying var_decls) and
 * pushes diagnostics for all three tiers. Returns the diagnostics it added.
 */
export function analyzeWorkerIsolation(program: ProgramIR, diagnostics: Diagnostic[]): Diagnostic[] {
  const added: Diagnostic[] = [];
  const push = (d: Diagnostic) => { diagnostics.push(d); added.push(d); };

  // 1. Identify worker-submitted functions via worker.submit HAL ops.
  const workerFnNames = new Set<string>();
  scanForWorkerSubmitOps(program, (fnRef) => {
    // fnRef is the C++ symbol; the IR function name is usually the same root.
    workerFnNames.add(fnRef);
  });
  if (workerFnNames.size === 0) return added;

  // 2. Collect the bodies of worker functions present in this program.
  const workerBodies: StatementIR[][] = [];
  for (const name of workerFnNames) {
    const fn = findFunctionByName(program, name);
    if (fn && Array.isArray(fn.statements)) workerBodies.push(fn.statements);
  }
  if (workerBodies.length === 0) return added;

  // ── Tier (b): bus access in workers → HARD ERROR ────────────────────────
  for (let i = 0; i < workerFnNames.size; i++) {
    const name = [...workerFnNames][i];
    const fn = findFunctionByName(program, name);
    if (!fn || !Array.isArray(fn.statements)) continue;
    const busHits: { name: string; span: any }[] = [];
    collectBusAccesses(fn.statements, busHits);
    for (const hit of busHits) {
      push({
        severity: 'error',
        message: `Worker function '${name}' accesses bus '${hit.name}'. Bus access is forbidden in worker functions because the take()/release() bus-ownership lock is not implemented at runtime — two threads would race on the wire despite validation passing.`,
        hint: `Keep workers compute/pure-only. Bus-sharing workers require the take()/release() runtime backend (a planned follow-on).`,
        filePath: (hit.span ?? fn.sourceSpan)?.filePath,
        line: (hit.span ?? fn.sourceSpan)?.startLine,
        column: (hit.span ?? fn.sourceSpan)?.startColumn,
        code: 'worker-bus-access-forbidden',
        source: 'worker-analysis',
      });
    }
  }

  // ── Tier (a): shared globals → volatile + warning ───────────────────────
  const globalVars = new Map<string, StatementIR>();
  for (const stmt of program.topLevelStatements) {
    if (stmt.kind === 'var_decl' && typeof (stmt as any).name === 'string') {
      globalVars.set((stmt as any).name, stmt);
    }
  }
  if (globalVars.size === 0) return added;

  // Names assigned inside worker bodies.
  const workerAssigned = new Set<string>();
  for (const body of workerBodies) collectAssignedNames(body, workerAssigned);
  if (workerAssigned.size === 0) return added;

  // Names assigned AND read in main (non-worker) code.
  const mainAssigned = new Set<string>();
  const mainRead = new Set<string>();
  for (const stmt of program.topLevelStatements) {
    collectReadNames([stmt], mainRead);
    collectAssignedNames([stmt], mainAssigned);
  }
  for (const fn of program.functions) {
    // Skip the worker functions themselves when collecting main usage.
    if (workerFnNames.has((fn as any).name) || workerFnNames.has((fn as any).originalName)) continue;
    if (Array.isArray(fn.statements)) {
      collectReadNames(fn.statements, mainRead);
      collectAssignedNames(fn.statements, mainAssigned);
    }
  }

  for (const [name, stmt] of globalVars) {
    if (!workerAssigned.has(name)) continue;
    const workerShared = stmt as any;
    if (mainRead.has(name) && !mainAssigned.has(name)) {
      // worker-written + main-read → promote to volatile (the barrier makes the
      // write visible; volatile stops the compiler caching the read).
      if (!workerShared.isVolatile) {
        workerShared.isVolatile = true;
        push({
          severity: 'info',
          message: `'${name}' is written in a worker function and read in main code — emitted as \`volatile\` so the compiler does not cache it in a register across the worker/main boundary.`,
          filePath: workerShared.sourceSpan?.filePath,
          line: workerShared.sourceSpan?.startLine,
          column: workerShared.sourceSpan?.startColumn,
          code: 'volatile-worker-shared',
          source: 'worker-analysis',
        });
      }
    } else if (mainAssigned.has(name)) {
      // worker-written + main-written → true data race; barrier alone can't fix.
      push({
        severity: 'warning',
        message: `'${name}' is written by both a worker function and main-thread code — a data race the worker completion barrier alone cannot fix. Restructure so only one side writes it (e.g. the worker writes; main only reads).`,
        hint: `Move all writes to '${name}' into the worker (or into main); do not mutate it from both.`,
        filePath: workerShared.sourceSpan?.filePath,
        line: workerShared.sourceSpan?.startLine,
        column: workerShared.sourceSpan?.startColumn,
        code: 'worker-shared-mutable',
        source: 'worker-analysis',
      });
    }
  }

  return added;
}
