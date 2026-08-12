import { describe, it, expect } from 'vitest';
import { ZephyrStrategy } from '../../../../packages/framework-zephyr/src/strategy';

// Display gating now uses the shared analyzer's usesDisplay flag (set by
// display.* hal-ops) injected via ctx.analysis, replacing the per-framework
// programUsesDisplay IR walk. The minimal ProgramIR shapes below are kept for
// resolveDisplayOp parity; the gating tests inject the analysis flag directly.
const programWithDisplay = {
  functions: [{
    statements: [{
      kind: 'hal-op',
      operation: { operation: 'display.init', bus: 'SPI0' },
    }],
  }],
} as any;

const programWithoutDisplay = { functions: [{ statements: [] }] } as any;

describe('ZephyrStrategy display wiring', () => {
  const s = new ZephyrStrategy();

  it('resolveDisplayOp lowers all 5 ops (seeds default on probe)', () => {
    expect(s.resolveDisplayOp({ operation: 'display.init' } as any)?.code).toContain('display_init');
    expect(s.resolveDisplayOp({ operation: 'display.fill_rect', x: 0, y: 0, w: 1, h: 1, color: 1 } as any)?.code).toContain('display_fill_rect');
    expect(s.resolveDisplayOp({ operation: 'display.draw_rect', x: 0, y: 0, w: 1, h: 1, color: 1 } as any)?.code).toContain('display_draw_rect');
    expect(s.resolveDisplayOp({ operation: 'display.draw_text', x: 0, y: 0, text: 'A', color: 1 } as any)?.code).toContain('display_draw_text');
    expect(s.resolveDisplayOp({ operation: 'display.flush' } as any)?.code).toContain('display_flush');
  });

  it('supportedDisplayDrivers lists the registry driver ids', () => {
    expect([...s.supportedDisplayDrivers()]).toContain('ili9341-zephyr');
  });

  it('graphicsCapacity is non-zero (Arduino parity)', () => {
    const c = s.graphicsCapacity();
    expect(c.maxNodes).toBeGreaterThan(0);
    expect(c.maxBindings).toBeGreaterThan(0);
  });

  it('forcedIncludes adds <zephyr/drivers/display.h> when the program uses display', () => {
    const inc = s.forcedIncludes(programWithDisplay, { frameworkData: {}, analysis: { usesDisplay: true } } as any);
    expect(inc).toContain('<zephyr/drivers/display.h>');
  });

  it('forcedIncludes omits <zephyr/drivers/display.h> when the program has no display', () => {
    const inc = s.forcedIncludes(programWithoutDisplay, { frameworkData: {}, analysis: { usesDisplay: false } } as any);
    expect(inc).not.toContain('<zephyr/drivers/display.h>');
  });

  it('shimLines omits the direct display runtime — the strategy provides its own display adapter', () => {
    // providesDisplayAdapter() is always true: the adapter (resolveDisplayAdapter)
    // emits the display_* runtime (display_init, __tc_display_line, …) for the
    // strategy-owned drivers (ili9341-zephyr, st7796-zephyr). shimLines must NOT
    // also emit the direct-call runtime — the two define the same symbols and
    // would collide at link time. (buildDisplayRuntime is covered directly in
    // display/gfx.test.ts; the adapter in zephyr-display-adapter.test.ts.)
    expect(s.providesDisplayAdapter()).toBe(true);
    const lines = s.shimLines(programWithDisplay, { frameworkData: {}, analysis: { usesDisplay: true } } as any);
    const joined = lines.join('\n');
    expect(joined).not.toContain('CUTTLEFISH_DISPLAY_BEGIN');
    expect(joined).not.toContain('__tc_display_line');
  });

  it('shimLines omits the display runtime when the program has no display', () => {
    const lines = s.shimLines(programWithoutDisplay, { frameworkData: {}, analysis: { usesDisplay: false } } as any);
    expect(lines.join('\n')).not.toContain('CUTTLEFISH_DISPLAY_BEGIN');
  });
});
