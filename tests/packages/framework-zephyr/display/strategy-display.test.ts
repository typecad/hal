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

  it('supportedDisplayDrivers lists the registry driver ids (incl. OLED)', () => {
    const drivers = [...s.supportedDisplayDrivers()];
    expect(drivers).toContain('ili9341-zephyr');
    expect(drivers).toContain('st7796-zephyr');
    expect(drivers).toContain('ssd1306-zephyr');
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

  it('shimLines EMITS the direct display runtime for a non-UI display program', () => {
    // Gating is `usesDisplay && !entryHasUI()`: a program that uses display.*
    // directly (no @typecad/ui) has no UI adapter emitted (the adapter is built
    // only under entryHasUI(), in cuttlefish's emitUIRuntime), so shimLines must
    // supply the display_* definitions itself. entryHasUI() is false in unit
    // tests (@typecad/ui is never loaded), so the runtime is emitted here.
    expect(s.providesDisplayAdapter()).toBe(true); // static capability (always true)
    const lines = s.shimLines(programWithDisplay, { frameworkData: {}, analysis: { usesDisplay: true } } as any);
    const joined = lines.join('\n');
    expect(joined).toContain('CUTTLEFISH_DISPLAY_BEGIN');
    expect(joined).toContain('display_init');
    // Default profile is ili9341 (rgb565) → one-row line buffer.
    expect(joined).toContain('__tc_display_line');
  });

  it('resolveDisplayAdapter provides a TFT adapter but DECLINES mono (OLED)', () => {
    // The UI adapter is RGB565/SPI (TFT) only. Mono OLEDs use the direct
    // display.* GFX runtime; there is no CuttlefishGFX UI path for mono.
    const tft = s.resolveDisplayAdapter({ driver: 'ili9341-zephyr' } as any);
    expect(tft).toBeDefined();
    const mono = s.resolveDisplayAdapter({ driver: 'ssd1306-zephyr' } as any);
    expect(mono).toBeUndefined();
    // An unknown driver is also declined.
    expect(s.resolveDisplayAdapter({ driver: 'nope' } as any)).toBeUndefined();
  });

  it('shimLines omits the display runtime when the program has no display', () => {
    const lines = s.shimLines(programWithoutDisplay, { frameworkData: {}, analysis: { usesDisplay: false } } as any);
    expect(lines.join('\n')).not.toContain('CUTTLEFISH_DISPLAY_BEGIN');
  });
});
