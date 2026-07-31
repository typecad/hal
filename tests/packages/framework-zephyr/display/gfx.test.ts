import { describe, it, expect } from 'vitest';
import { buildDisplayRuntime, type DisplayRuntimeResult } from '../../../../packages/framework-zephyr/src/display/gfx';
import { ZEPHYR_DISPLAY_PROFILES, DEFAULT_ZEPHYR_DISPLAY_PROFILE } from '../../../../packages/framework-zephyr/src/display/profiles';

const profile = ZEPHYR_DISPLAY_PROFILES['ili9341-zephyr'];

describe('display runtime builder', () => {
  it('returns the device handle declaration, line buffer, and helper fns', () => {
    const r: DisplayRuntimeResult = buildDisplayRuntime(profile);
    expect(r.includes).toEqual(['<zephyr/drivers/display.h>']);
    const all = r.stateLines.join('\n') + '\n' + r.helpers;
    expect(all).toContain('DEVICE_DT_GET(DT_NODELABEL(display0))');
    expect(all).toContain('static uint16_t __tc_display_line[320]'); // width-sized line buffer
    expect(all).toContain('display_init');
    expect(all).toContain('display_fill_rect');
    expect(all).toContain('display_draw_rect');
    expect(all).toContain('display_draw_text');
    expect(all).toContain('display_flush');
  });

  it('display_init enables the device + backlight + blanking off', () => {
    const r = buildDisplayRuntime(profile);
    expect(r.helpers).toContain('device_is_ready');
    expect(r.helpers).toContain('display_blanking_off');
    expect(r.helpers).toContain('gpio_pin_set'); // backlight on
  });

  it('font table covers only 0-9 and A-Z (no lowercase, no punctuation)', () => {
    const r = buildDisplayRuntime(profile);
    const table = r.fontTable;
    // Digits and uppercase present as table entries.
    expect(table).toMatch(/'0'/);
    expect(table).toMatch(/'9'/);
    expect(table).toMatch(/'A'/);
    expect(table).toMatch(/'Z'/);
    // Lowercase + punctuation NOT present as table entries.
    expect(table).not.toMatch(/'a'/);
    expect(table).not.toMatch(/'z'/);
    expect(table).not.toMatch(/'!'/);
  });

  it('draw_text falls back unknown chars to a space', () => {
    const r = buildDisplayRuntime(profile);
    // Falls back to the space glyph (AUTOSAR-clean static_cast form).
    expect(r.helpers).toContain("glyph = &__tc_font5x7[static_cast<uint8_t>(' ')][0]");
  });

  it('DEFAULT profile is the ili9341 entry', () => {
    expect(DEFAULT_ZEPHYR_DISPLAY_PROFILE.driver).toBe('ili9341-zephyr');
  });
});
