import { describe, it, expect } from 'vitest';
import { ZephyrStrategy } from '../../../../packages/framework-zephyr/src/strategy';

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

  it('forcedIncludes adds <zephyr/drivers/display.h> when usesDisplay', () => {
    const inc = s.forcedIncludes(undefined, { analysis: { usesDisplay: true } } as any);
    expect(inc).toContain('<zephyr/drivers/display.h>');
  });

  it('shimLines emits the display runtime when usesDisplay', () => {
    const lines = s.shimLines(undefined, { frameworkData: {}, analysis: { usesDisplay: true } } as any);
    const joined = lines.join('\n');
    expect(joined).toContain('CUTTLEFISH_DISPLAY_BEGIN');
    expect(joined).toContain('__tc_display_line');
    expect(joined).toContain('display_fill_rect');
  });
});
