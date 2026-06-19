// ---------------------------------------------------------------------------
// Heap Allocation Validator (retired — moved to the emit-time profile gate)
//
// Heap allocation via `new` on no-heap architectures (AVR, etc.) is now
// rejected by the Arduino strategy's `profileDiagnostics`
// (`framework-arduino/src/strategy.ts` `collectHeapAllocationDiagnostics`).
//
// WHY THE MOVE: this build-time validator keyed off `boardConstants.architecture`,
// which is only populated when an MCU/board `import` is present. Programs with
// no such import silently bypassed it — so demo #33's `new Accumulator()`
// passed while a HAL-importing demo's `new Blinker()` failed, for the same
// source pattern. The profile-time gate derives `arch` from the FQBN
// (`frameworkData.buildTarget`), so it fires regardless of import structure
// (demo #34 Finding A). It also keys off the `newClassName` marker a user-class
// `new` tags its raw IR node with (set in `expression-to-ir.ts`), making
// detection structural rather than textual.
//
// The export is kept (returns `[]`) so `validation-orchestrator.ts`'s import
// stays valid; the real work happens at emit time.
// ---------------------------------------------------------------------------

import type { Diagnostic } from '../types';
import type { BoardConstants } from './board-resolver';
import type { StatementIR } from '../api';
import type { PlatformStrategy } from '../api/shared';

/**
 * @deprecated Heap allocation is now validated at emit time by the platform
 * strategy's `profileDiagnostics` (see framework-arduino `collectHeapAllocationDiagnostics`).
 * This build-time stub returns no diagnostics. Kept to preserve the
 * `validation-orchestrator.ts` import; remove that call site when convenient.
 */
export function validateHeapArrayUsage(
  _program: {
    topLevelStatements: StatementIR[];
    functions: Array<{ statements: StatementIR[] }>;
    classes: Array<{
      methods: Array<{ statements: StatementIR[] }>;
      constructor?: { statements: StatementIR[] };
    }>;
  },
  _boardConstants: BoardConstants | undefined,
  _strategy?: PlatformStrategy,
): Diagnostic[] {
  return [];
}
