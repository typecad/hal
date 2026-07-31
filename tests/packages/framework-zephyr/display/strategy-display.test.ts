import { describe, it, expect } from 'vitest';
import { ZephyrStrategy } from '../../../../packages/framework-zephyr/src/strategy';

// A minimal ProgramIR carrying a single display.* op node, the shape
// programUsesDisplay walks for. Mirrors how the real analyzer would surface a
// display.init call — detection must not depend on an injected analysis flag
// (the analyzer exposes no usesDisplay flag).
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
    const inc = s.forcedIncludes(programWithDisplay, { frameworkData: {} } as any);
    expect(inc).toContain('<zephyr/drivers/display.h>');
  });

  it('forcedIncludes omits <zephyr/drivers/display.h> when the program has no display', () => {
    const inc = s.forcedIncludes(programWithoutDisplay, { frameworkData: {} } as any);
    expect(inc).not.toContain('<zephyr/drivers/display.h>');
  });

  it('shimLines emits the display runtime when the program uses display', () => {
    const lines = s.shimLines(programWithDisplay, { frameworkData: {} } as any);
    const joined = lines.join('\n');
    expect(joined).toContain('CUTTLEFISH_DISPLAY_BEGIN');
    expect(joined).toContain('__tc_display_line');
    expect(joined).toContain('display_fill_rect');
  });

  it('shimLines omits the display runtime when the program has no display', () => {
    const lines = s.shimLines(programWithoutDisplay, { frameworkData: {} } as any);
    expect(lines.join('\n')).not.toContain('CUTTLEFISH_DISPLAY_BEGIN');
  });
});
