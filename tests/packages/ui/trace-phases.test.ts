import { describe, it, expect } from 'vitest';
import { emitTick } from '../../../packages/ui/src/ui-engine/runtime-header/tick';
import { emitTickBindingsPhase } from '../../../packages/ui/src/ui-engine/runtime-header/tick/bindings-phase';
import { emitTickTransitionsPhase } from '../../../packages/ui/src/ui-engine/runtime-header/tick/transitions-phase';
import { emitTickDirtyDrawPhase } from '../../../packages/ui/src/ui-engine/runtime-header/tick/dirty-draw-phase';
import { emitTickScrollCanvasPhase } from '../../../packages/ui/src/ui-engine/runtime-header/tick/scroll-canvas-phase';
import { emitTickFlushPhase } from '../../../packages/ui/src/ui-engine/runtime-header/tick/flush-phase';

// The trace phase-span injection: emitTick interleaves CUTTLEFISH_TRACE_UI-
// guarded cycle captures at the four slice seams plus a prologue/epilogue
// pair. Untraced builds preprocess every injected line away, so the parity
// contract is: REMOVE the guarded blocks and the output is byte-identical
// to the plain slice concatenation (the pre-injection runtime).
describe('emitTick trace phase injection', () => {
  const plain = [
    emitTickBindingsPhase(),
    emitTickTransitionsPhase(),
    emitTickDirtyDrawPhase(),
    emitTickScrollCanvasPhase(),
    emitTickFlushPhase(),
  ].join('');

  // An injected chunk is newline-symmetric: \n#if defined(...)…#endif\n.
  // Stripping the chunks (with their surrounding newlines) must reproduce
  // the plain concatenation exactly — the untraced-build parity contract.
  const INJECTED = /\n#if defined\(CUTTLEFISH_TRACE_UI\)\n[\s\S]*?\n#endif\n/g;

  it('removing the injected blocks reproduces the plain concatenation byte-for-byte', () => {
    const stripped = emitTick().replace(INJECTED, '');
    expect(stripped).toBe(plain);
  });

  it('injects the phase accumulator calls at all five phase boundaries', () => {
    const out = emitTick();
    // Prologue timestamp + seams for phases 0..3 + the epilogue for phase 4.
    expect(out).toContain('uint64_t __tc_trace_ui_pt = k_cycle_get_64();');
    for (let i = 0; i < 5; i++) {
      expect(out).toContain(`__tc_trace_ui_phase_add(${i}, k_cycle_get_64() - __tc_trace_ui_pt);`);
    }
    // Order: seam 0 before seam 1 before ... before epilogue (4).
    const pos = [0, 1, 2, 3, 4].map((i) => out.indexOf(`__tc_trace_ui_phase_add(${i},`));
    expect(pos.every((p) => p > 0)).toBe(true);
    expect([...pos].sort((a, b) => a - b)).toEqual(pos);
  });

  it('never edits the slice bodies (the signature survives verbatim)', () => {
    expect(emitTick()).toContain('static inline void ui_tick(uint16_t deltaMs) {');
  });
});
