import { describe, it, expect } from 'vitest';
import { resolveZephyrDisplayOp, newDisplayState } from '../../../../packages/framework-zephyr/src/display';

describe('resolveZephyrDisplayOp', () => {
  // Fresh state per test — resolveZephyrDisplayOp is a pure function of (op, state).
  const state = () => newDisplayState();

  it('returns undefined for an unrecognized op', () => {
    expect(resolveZephyrDisplayOp({ operation: 'display.bogus' } as any, state())).toBeUndefined();
  });

  it('display.init seeds state and emits display_init()', () => {
    const st = state();
    const out = resolveZephyrDisplayOp({ operation: 'display.init' } as any, st);
    expect(out?.code).toContain('display_init()');
    expect(st.initialized).toBe(true);
  });

  it('after init: fill_rect lowers', () => {
    const st = state(); st.initialized = true;
    const out = resolveZephyrDisplayOp({ operation: 'display.fill_rect', x: 0, y: 0, w: 10, h: 10, color: 0xffff } as any, st);
    expect(out?.code).toContain('display_fill_rect');
  });

  it('after init: draw_rect / draw_text / flush lower', () => {
    const st = state(); st.initialized = true;
    expect(resolveZephyrDisplayOp({ operation: 'display.draw_rect', x: 0, y: 0, w: 10, h: 10, color: 0xffff } as any, st)?.code).toContain('display_draw_rect');
    expect(resolveZephyrDisplayOp({ operation: 'display.draw_text', x: 0, y: 0, text: 'HI', color: 0xffff } as any, st)?.code).toContain('display_draw_text');
    expect(resolveZephyrDisplayOp({ operation: 'display.flush' } as any, st)?.code).toContain('display_flush');
  });

  it('seeds a default profile when probed without init (validator probe path)', () => {
    // The manifest validator probes fill_rect/draw_text/draw_rect/flush directly
    // (no prior init). resolveZephyrDisplayOp must seed a default so probes lower.
    const st = state(); // not initialized
    const out = resolveZephyrDisplayOp({ operation: 'display.fill_rect', x: 0, y: 0, w: 10, h: 10, color: 0xffff } as any, st);
    expect(out?.code).toContain('display_fill_rect');
    expect(st.initialized).toBe(true); // seeded as a side effect
  });
});
