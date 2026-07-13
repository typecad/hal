// ---------------------------------------------------------------------------
// Timing Validation
//
// Detects blocking delay() calls inside loop(). On Arduino, loop() runs
// repeatedly and must return promptly so the runtime can service the async
// microtask queue, UI rendering, and sensor polling. A delay() inside loop()
// freezes all of these for the delay duration — directly causing the UI
// tearing/scroll-responsiveness problems the AGENTS.md rendering guardrails
// address at the display layer.
//
// The transpiler knows what loop() semantically is (the repeated entry point);
// g++ sees only an ordinary function. This validator flags blocking delays in
// loop()'s direct body so the user can replace them with the cooperative
// Async.sleep() / millis()-comparison pattern.
// ---------------------------------------------------------------------------

import type { ProgramIR, StatementIR } from '../api/index.js';
import type { Diagnostic } from '../types.js';
import { walkNestedStatements } from './utils/walk-ir.js';

/** Check a single statement for a blocking delay call or hal-op. */
function isBlockingDelay(stmt: StatementIR): boolean {
  const s = stmt as any;
  // Direct call: delay(...) or delayMicroseconds(...)
  if (stmt.kind === 'call' && typeof s.callee === 'string') {
    if (s.callee === 'delay' || s.callee === 'delayMicroseconds') return true;
  }
  // Hal-op: after HAL resolution, delay() becomes timing.delay /
  // timing.delay_microseconds.
  if (stmt.kind === 'hal-op' && s.operation?.operation) {
    if (s.operation.operation === 'timing.delay' || s.operation.operation === 'timing.delay_microseconds') {
      return true;
    }
  }
  return false;
}

/**
 * Detect blocking delay() calls inside loop()'s body. Emits a warning for
 * each, explaining the cooperative-async alternative.
 */
export function validateBlockingDelayInLoop(program: ProgramIR): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];

  const loopFn = program.functions.find(fn => fn.originalName === 'loop');
  if (!loopFn || !loopFn.statements) return diagnostics;

  const visit = (stmts: StatementIR[]): void => {
    for (const stmt of stmts) {
      if (isBlockingDelay(stmt)) {
        const s = stmt as any;
        diagnostics.push({
          severity: 'warning',
          message:
            `Blocking delay() inside loop() freezes the async microtask queue and UI rendering ` +
            `for the delay duration. This causes display tearing and makes the sketch unresponsive.`,
          hint:
            `Use the cooperative pattern instead: track elapsed time with millis() comparisons, ` +
            `or use Async.sleep(ms) / Async.yield() to let other tasks run between checks.`,
          line: (stmt as any).sourceSpan?.startLine,
          column: (stmt as any).sourceSpan?.startColumn,
          code: 'blocking-delay-in-loop',
          source: 'timing-validation',
        });
      }
      // Recurse into nested compound bodies (if/for/while/switch/try blocks).
      const nested = getNested(stmt);
      if (nested) visit(nested);
    }
  };

  visit(loopFn.statements);
  return diagnostics;
}

/** Get nested statement arrays from a compound statement. */
function getNested(stmt: StatementIR): StatementIR[] | null {
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
  // for-loop initializer/increment are statements too.
  if (s.initializer && typeof s.initializer === 'object' && s.initializer.kind) out.push(s.initializer);
  if (s.increment && typeof s.increment === 'object' && s.increment.kind) out.push(s.increment);
  return out.length > 0 ? out : null;
}
