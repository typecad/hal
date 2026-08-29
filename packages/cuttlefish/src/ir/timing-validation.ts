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
//
// IMPORTANT: on RTOS targets (ESP-IDF / FreeRTOS), delay() lowers to
// vTaskDelay which YIELDS the CPU — it does not freeze other tasks, UI
// rendering, or the async queue. Only delayMicroseconds (esp_rom_delay_us)
// is a true busy-wait. So for RTOS targets, only delay_microseconds triggers
// the warning; delay is safe.
// ---------------------------------------------------------------------------

import type { ProgramIR, StatementIR } from '../api/index.js';
import type { Diagnostic } from '../types.js';
import type { PlatformStrategy } from '../api/shared/index.js';
import { walkNestedStatements } from './utils/walk-ir.js';
import { hasLoadedFramework, getLoadedFramework } from '../framework-registry.js';

/** Check a single statement for a blocking delay call or hal-op.
 *  On RTOS targets, timing.delay (vTaskDelay) is NOT blocking — only
 *  timing.delay_microseconds (esp_rom_delay_us) is. */
function isBlockingDelay(stmt: StatementIR, isRtos: boolean): boolean {
  const s = stmt as any;
  // Derive the blocking delay call names from the loaded framework's
  // ISR-unsafe table (delay, delayMicroseconds on Wiring-derived frameworks).
  // Fall back to those two names when no framework is loaded.
  const frameworkUnsafe = hasLoadedFramework()
    ? getLoadedFramework().strategy.isrUnsafeOperations?.()
    : undefined;
  const delayNames = frameworkUnsafe
    ? [...frameworkUnsafe.keys()].filter(k => k === 'delay' || k === 'delayMicroseconds')
    : ['delay', 'delayMicroseconds'];
  // Direct call: a blocking delay call by name.
  if (stmt.kind === 'call' && typeof s.callee === 'string') {
    if (isRtos) {
      // On RTOS targets, only delayMicroseconds is a busy-wait.
      if (s.callee === 'delayMicroseconds') return true;
    } else {
      if (delayNames.includes(s.callee)) return true;
    }
  }
  // Hal-op: after HAL resolution, delay() becomes timing.delay /
  // timing.delay_microseconds.
  if (stmt.kind === 'hal-op' && s.operation?.operation) {
    if (isRtos) {
      // On RTOS targets, only timing.delay_microseconds is blocking.
      if (s.operation.operation === 'timing.delay_microseconds') return true;
    } else {
      if (s.operation.operation === 'timing.delay' || s.operation.operation === 'timing.delay_microseconds') {
        return true;
      }
    }
  }
  return false;
}

/**
 * Detect blocking delay() calls inside loop()'s body. Emits a warning for
 * each, explaining the cooperative-async alternative.
 *
 * On RTOS targets (ESP-IDF), timing.delay lowers to vTaskDelay which yields
 * the CPU — it does NOT freeze the async queue or UI. Only delayMicroseconds
 * (busy-wait) triggers the warning.
 */
export function validateBlockingDelayInLoop(program: ProgramIR, strategy?: PlatformStrategy): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];

  // Detect RTOS targets where delay() yields rather than blocks.
  // framework-esp32 uses FreeRTOS; vTaskDelay is a yielding delay.
  const isRtos = strategy?.isRtosTarget?.() === true
    || (hasLoadedFramework() && getLoadedFramework().strategy.isRtosTarget?.() === true);

  const loopFn = program.functions.find(fn => fn.originalName === 'loop');
  if (!loopFn || !loopFn.statements) return diagnostics;

  const visit = (stmts: StatementIR[]): void => {
    for (const stmt of stmts) {
      if (isBlockingDelay(stmt, isRtos)) {
        const s = stmt as any;
        const message = isRtos
          ? `Blocking delayMicroseconds() inside loop() is a busy-wait that wastes CPU cycles. ` +
            `On RTOS targets (ESP-IDF), prefer timing.delay() (vTaskDelay) which yields the CPU to other tasks.`
          : `Blocking delay() inside loop() freezes the async microtask queue and UI rendering ` +
            `for the delay duration. This causes display tearing and makes the program unresponsive.`;
        const hint = isRtos
          ? `Replace delayMicroseconds with delay() if the timing permits, or accept the brief busy-wait if sub-millisecond precision is required.`
          : `Use the cooperative pattern instead: track elapsed time with millis() comparisons, ` +
            `or use Async.sleep(ms) / Async.yield() to let other tasks run between checks.`;
        diagnostics.push({
          severity: 'warning',
          message,
          hint,
          line: (stmt as any).sourceSpan?.startLine,
          column: (stmt as any).sourceSpan?.startColumn,
          filePath: (stmt as any).sourceSpan?.filePath,
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
