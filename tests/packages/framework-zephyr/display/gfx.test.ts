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

  it('RGB565 (TFT) uses a one-row line buffer, not a framebuffer', () => {
    const r = buildDisplayRuntime(ZEPHYR_DISPLAY_PROFILES['ili9341-zephyr']);
    expect(r.stateLines.join('\n')).toContain('static uint16_t __tc_display_line[320]'); // width line buffer
    // A TFT path must NOT emit the mono framebuffer / set_pixel packer.
    expect(r.stateLines.join('\n')).not.toContain('__tc_display_fb');
    expect(r.helpers).not.toContain('__tc_set_pixel');
  });
});

// SSD1306-class monochrome OLED: full framebuffer, MONO01 packing.
describe('display runtime builder — mono (OLED)', () => {
  const profile = ZEPHYR_DISPLAY_PROFILES['ssd1306-zephyr'];

  it('the profile is 128x64 mono', () => {
    expect(profile.width).toBe(128);
    expect(profile.height).toBe(64);
    expect(profile.colorFormat).toBe('mono');
  });

  it('emits a mono framebuffer sized (W*H+7)/8 (1024 bytes for 128x64)', () => {
    const r = buildDisplayRuntime(profile);
    expect(r.stateLines.join('\n')).toContain('static uint8_t __tc_display_fb[((128 * 64) + 7) / 8]');
    // No RGB565 line buffer on the mono path.
    expect(r.stateLines.join('\n')).not.toContain('__tc_display_line');
  });

  it('packs pixels MONO01 horizontal MSB-first (byte = y*16 + x>>3, bit = 0x80 >> x&7)', () => {
    const r = buildDisplayRuntime(profile);
    const h = r.helpers;
    // 128/8 = 16 bytes per row.
    expect(h).toContain('static_cast<uint32_t>(y) * 16U');
    expect(h).toContain('(x >> 3)');
    expect(h).toContain('0x80U >> (x & 7U)');
    // set (OR mask) + clear (AND ~mask) branches.
    expect(h).toContain('__tc_display_fb[idx] | mask');
    expect(h).toContain('& static_cast<uint8_t>(~mask)');
  });

  it('display_flush writes the whole framebuffer (buf_size=sizeof, pitch=16, 128x64)', () => {
    const r = buildDisplayRuntime(profile);
    const flush = r.helpers;
    expect(flush).toContain('display_write(__tc_display, 0, 0');
    expect(flush).toContain('buf_size = sizeof(__tc_display_fb)');
    expect(flush).toContain('width = 128U');
    expect(flush).toContain('height = 64U');
    expect(flush).toContain('pitch = 16U');
  });

  it('maps color != 0 to lit (on), so fill_rect/draw_text are additive', () => {
    const r = buildDisplayRuntime(profile);
    expect(r.helpers).toContain('uint8_t on = (color != 0U) ? 1U : 0U;');
    // draw_text sets glyph pixels via __tc_set_pixel (additive, no clear).
    expect(r.helpers).toContain('__tc_set_pixel(static_cast<uint16_t>(cx + col)');
  });

  it('still carries display_init/fill_rect/draw_rect/draw_text/flush + the font table', () => {
    const r = buildDisplayRuntime(profile);
    const all = r.stateLines.join('\n') + '\n' + r.helpers;
    for (const fn of ['display_init', 'display_fill_rect', 'display_draw_rect', 'display_draw_text', 'display_flush']) {
      expect(all).toContain(fn);
    }
    expect(r.fontTable).toMatch(/'A'/);
  });
});
