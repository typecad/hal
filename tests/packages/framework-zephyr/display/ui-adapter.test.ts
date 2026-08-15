import { describe, it, expect } from 'vitest';
import { zephyrUiDisplayAdapter } from '../../../../packages/framework-zephyr/src/display/ui-adapter';
import { ZEPHYR_DISPLAY_PROFILES } from '../../../../packages/framework-zephyr/src/display/profiles';

describe('zephyrUiDisplayAdapter per-controller emission', () => {
  describe('ST7796S (hardware-verified path)', () => {
    const code = zephyrUiDisplayAdapter(ZEPHYR_DISPLAY_PROFILES['st7796-zephyr']);

    it('drives the 18-bit transport with the verified init sequence', () => {
      expect(code.functions).toContain('__tc_pnl_pack666');
      expect(code.functions).toContain('__tc_pnl_pixels666');
      expect(code.functions).not.toContain('__tc_pnl_pack565');
      // COLMOD 0x66 (18-bit) + MADCTL 0x28.
      expect(code.functions).toContain('COLMOD 0x66');
      expect(code.functions).toContain('{0x36, 1, __tc_pnl_i4, 0}');
    });

    it('resolves the panel through the default bus + bridge labels', () => {
      expect(code.functions).toContain('GPIO_DT_SPEC_GET(DT_NODELABEL(spi2), cs_gpios)');
      expect(code.functions).toContain('GPIO_DT_SPEC_GET(DT_NODELABEL(mipi_dbi), dc_gpios)');
    });
  });

  describe('ILI9341', () => {
    const code = zephyrUiDisplayAdapter(ZEPHYR_DISPLAY_PROFILES['ili9341-zephyr']);

    it('drives the 16-bit RGB565 transport', () => {
      expect(code.functions).toContain('__tc_pnl_pack565');
      expect(code.functions).toContain('__tc_pnl_pixels565');
      expect(code.functions).not.toContain('__tc_pnl_pack666');
      // COLMOD 0x55 (16-bit) — the ILI9341 native wire format.
      expect(code.functions).toContain('COLMOD 0x55 (16-bit RGB565)');
      expect(code.functions).toContain('{0x3A, 1, __tc_pnl_i13, 0}');
    });

    it('packs pixels big-endian with no 666 expansion', () => {
      // 2-byte packing: high byte then low byte of the rgb565 word.
      expect(code.functions).toContain('static_cast<uint8_t>(c >> 8)');
      expect(code.functions).not.toContain('& 0xF8u);\n    __tc_display_row3');
    });

    it('uses the Adafruit ILI9341 init sequence', () => {
      // SWRESET + SLPOUT + DISPON pacing + gamma tables.
      expect(code.functions).toContain('{0x01, 0, NULL, 150}');
      expect(code.functions).toContain('{0x11, 0, NULL, 150}');
      expect(code.functions).toContain('{0x29, 0, NULL, 150}');
      expect(code.functions).toContain('PGAMCTRL');
      expect(code.functions).toContain('NGAMCTRL');
      // MADCTL 0x28: MV landscape + BGR (same convention as the ST7796S path).
      expect(code.functions).toContain('MADCTL 0x28');
    });

    it('sizes the row/block scratch buffers at 2 bytes per pixel', () => {
      expect(code.declaration).toContain('static uint8_t __tc_display_row2[320 * 2];');
      expect(code.declaration).toContain(
        'static uint8_t __tc_display_block2[320 * 2 * __TC_FILL_ROWS];',
      );
    });
  });

  describe('bus + bridge parameterization', () => {
    it('threads custom labels through the transport', () => {
      const code = zephyrUiDisplayAdapter({
        ...ZEPHYR_DISPLAY_PROFILES['st7796-zephyr'],
        busLabel: 'spi3',
        bridgeLabel: 'panel_bridge',
      });
      expect(code.functions).toContain('GPIO_DT_SPEC_GET(DT_NODELABEL(spi3), cs_gpios)');
      expect(code.functions).toContain('GPIO_DT_SPEC_GET(DT_NODELABEL(panel_bridge), dc_gpios)');
      expect(code.functions).not.toContain('DT_NODELABEL(spi2)');
    });
  });
});
