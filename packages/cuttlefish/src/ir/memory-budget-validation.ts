// ---------------------------------------------------------------------------
// Memory Budget Validation
//
// Compares the transpiler's static memory estimate against the board's SRAM
// budget. On AVR, the 2 KB SRAM is shared by globals/static data (grows up
// from .bss/.data), the heap (grows up from the end of .bss), and the stack
// (grows down from the top). There is no MMU — collision corrupts memory
// silently, producing the classic "works in debug, crashes in release"
// embedded failure.
//
// The transpiler knows the board's SRAM (boardConstants) and can estimate
// static bytes + call depth — something g++ cannot do (it has no concept of
// the board's memory size). This validator surfaces a warning when the
// estimated budget is tight, so the user can act before hardware surprises.
// ---------------------------------------------------------------------------

import type { ProgramIR } from '../api/index.js';
import type { BoardConstants } from '../api/shared/index.js';
import type { Diagnostic } from '../types.js';
import { analyzeHeapUsage } from './heap-analysis.js';
import { buildCallGraph } from './call-graph.js';

/**
 * Conservative per-stack-frame estimate in bytes. A minimal AVR function frame
 * (return address + saved registers + a few locals) is 4-16 bytes; we use the
 * upper bound to avoid underestimating. This is inherently approximate — the
 * goal is to surface a tight budget, not to predict an exact collision.
 */
const ESTIMATED_FRAME_BYTES = 16;

/** Warn when estimated usage exceeds this fraction of SRAM. */
const WARN_FRACTION = 0.80;

/**
 * Validate that the estimated memory budget fits within the board's SRAM.
 * Emits a warning when static globals + estimated stack frames exceed 80% of
 * SRAM. Only runs when boardConstants provides `memory.sram` and
 * `architecture`.
 */
export function validateMemoryBudget(
  program: ProgramIR,
  boardConstants: BoardConstants | undefined,
): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  if (!boardConstants) return diagnostics;

  const architecture = boardConstants.get('architecture') as string | undefined;
  if (architecture === undefined) return diagnostics;

  // SRAM budget: prefer the board constant, fall back to a per-architecture
  // default. The memory.sram constant may be absent because
  // resolveAndMergeMCUConstants skips MCU resolution when the board file
  // already produced pins.all.* entries (e.g. the Uno spreads ATmega328P.pins).
  // The fallback covers the common AVR boards where this matters most.
  const ARCH_SRAM_DEFAULTS: Record<string, number> = {
    avr: 2048,
    megaavr: 6144,
    esp32: 327680,
    esp32s2: 327680,
    esp32s3: 327680,
    esp32c3: 327680,
    esp32c6: 327680,
  };
  const sramBytes = (boardConstants.get('memory.sram') as number | undefined)
    ?? ARCH_SRAM_DEFAULTS[architecture];
  if (sramBytes === undefined) return diagnostics;

  // Compute the static estimate + stack depth. analyzeHeapUsage needs the call
  // graph for stack-depth estimation.
  const callGraph = buildCallGraph(program);
  const estimate = analyzeHeapUsage(program, architecture, callGraph.nodes);

  // Estimate stack bytes: depth × per-frame. This is a lower bound (each frame
  // may hold locals larger than the default), so frame it conservatively.
  const estimatedStackBytes = estimate.estimatedStackDepth * ESTIMATED_FRAME_BYTES;
  const totalEstimated = estimate.totalStaticBytes + estimatedStackBytes;
  const fraction = totalEstimated / sramBytes;

  if (fraction >= WARN_FRACTION) {
    const sramKb = (sramBytes / 1024).toFixed(1);
    const staticKb = (estimate.totalStaticBytes / 1024).toFixed(2);
    const stackKb = (estimatedStackBytes / 1024).toFixed(2);
    const totalKb = (totalEstimated / 1024).toFixed(2);
    diagnostics.push({
      severity: fraction >= 1.0 ? 'error' : 'warning',
      message:
        `Estimated SRAM usage is ${(fraction * 100).toFixed(0)}% of the ${sramKb} KB budget ` +
        `(statics ${staticKb} KB + stack ~${stackKb} KB = ~${totalKb} KB). ` +
        (fraction >= 1.0
          ? `This exceeds available SRAM and will likely corrupt memory at runtime.`
          : `Stack and heap share the remaining space; deep call chains or heap allocation risk collision.`),
      hint:
        `Reduce global/static data, move large buffers to PROGMEM (flash), shorten deep call chains, ` +
        `or use a board with more SRAM. See the heap estimate in the diagnostics report for a breakdown.`,
      filePath: program.fileName,
      code: 'memory-budget',
      source: 'memory-budget-validation',
    });
  }

  return diagnostics;
}
