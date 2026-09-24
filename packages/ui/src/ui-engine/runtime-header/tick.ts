// ui_tick (original source lines 3930-5298) split into 5 contiguous phase slices.
// The phases tile 3930-5298 with no gaps; concatenation reproduces the original
// byte-for-byte. No wrapper logic — just ordered concatenation.
//
// Trace phase spans: when the build carries runtime tracing (Zephyr's
// zephyr.trace defines CUTTLEFISH_TRACE_UI in the entry TU), the assembly
// interleaves cycle captures at the four slice seams plus a prologue/epilogue
// pair, feeding __tc_trace_ui_phase_add(<phase>, cycles) — the heartbeat then
// reports per-phase microseconds as [TR:UP:...] lines. Everything sits under
// #if defined(CUTTLEFISH_TRACE_UI): an untraced build preprocesses the whole
// apparatus away (the slices themselves are never edited).
import { emitTickBindingsPhase } from "./tick/bindings-phase.js";
import { emitTickTransitionsPhase } from "./tick/transitions-phase.js";
import { emitTickDirtyDrawPhase } from "./tick/dirty-draw-phase.js";
import { emitTickScrollCanvasPhase } from "./tick/scroll-canvas-phase.js";
import { emitTickFlushPhase } from "./tick/flush-phase.js";

/** Stable anchor for the prologue injection (slice 1 owns the signature). */
const TICK_SIGNATURE = "static inline void ui_tick(uint16_t deltaMs) {";

/** Phase labels, index-matched to the seams below (host-side display). */
export const UI_TICK_PHASE_LABELS = ['bindings', 'transitions', 'draw', 'scroll', 'flush'] as const;

/** One injected chunk is exactly \n#if defined(CUTTLEFISH_TRACE_UI)\n…\n#endif\n
 *  — newline-symmetric on both sides, so stripping the chunks reproduces the
 *  plain slice concatenation byte-for-byte (the parity contract). */
function phaseSeam(idx: number): string {
  return [
    '',
    '#if defined(CUTTLEFISH_TRACE_UI)',
    // 32-bit cycle deltas, not the 64-bit API: that one silently returns
    // 0 on SoCs without CONFIG_TIMER_HAS_64BIT_CYCLE_COUNTER (esp32s3,
    // nRF... — the __ASSERT compiles out in release), which zeroed every
    // phase span on real hardware. The 32-bit counter works on every Zephyr
    // board and unsigned subtraction is wrap-safe; a phase delta (< 1 s of
    // cycles) always fits in 2^32.
    `  __tc_trace_ui_phase_add(${idx}, k_cycle_get_32() - __tc_trace_ui_pt);`,
    '  __tc_trace_ui_pt = k_cycle_get_32();',
    '#endif',
    '',
  ].join('\n');
}

export function emitTick(): string {
  const slices = [
    emitTickBindingsPhase(),
    emitTickTransitionsPhase(),
    emitTickDirtyDrawPhase(),
    emitTickScrollCanvasPhase(),
    emitTickFlushPhase(),
  ];
  const plain = slices.join('');
  if (!plain.includes(TICK_SIGNATURE)) {
    // The signature anchor moved (a slice edit) — emit the plain
    // concatenation rather than corrupting the runtime. The anchor test
    // fails loudly so this never ships silently.
    return plain;
  }
  const prologue = `${TICK_SIGNATURE}\n#if defined(CUTTLEFISH_TRACE_UI)\n  uint32_t __tc_trace_ui_pt = k_cycle_get_32();\n#endif\n`;
  const epilogue = phaseSeam(4);
  return [
    slices[0], phaseSeam(0),
    slices[1], phaseSeam(1),
    slices[2], phaseSeam(2),
    slices[3], phaseSeam(3),
    slices[4],
    epilogue,
  ].join('').replace(TICK_SIGNATURE, prologue);
}
