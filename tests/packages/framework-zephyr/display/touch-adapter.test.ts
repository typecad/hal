import { describe, it, expect } from 'vitest';
import { zephyrTouchAdapter } from '../../../../packages/framework-zephyr/src/display/touch-adapter';

describe('zephyrTouchAdapter', () => {
  it('declines libraries the framework does not handle', () => {
    expect(zephyrTouchAdapter({ library: 'GT911', calibration: { xMin: 0, xMax: 1, yMin: 0, yMax: 1 } })).toBeUndefined();
    expect(zephyrTouchAdapter({ library: 'sdl', calibration: { xMin: 0, xMax: 1, yMin: 0, yMax: 1 } })).toBeUndefined();
  });

  describe('XPT2046 (resistive, SPI)', () => {
    const code = zephyrTouchAdapter({
      library: 'XPT2046_Touchscreen', cs: 6, irq: 7,
      calibration: { xMin: 200, xMax: 3900, yMin: 180, yMax: 3800 },
    })!;

    it('emits the three ui_poll_touch symbols', () => {
      expect(code.functions).toContain('touch_init()');
      expect(code.functions).toContain('touch_isTouched()');
      expect(code.functions).toContain('touch_readRaw(');
    });

    it('resolves the controller through the devicetree spec', () => {
      expect(code.declaration).toContain('SPI_DT_SPEC_GET(DT_NODELABEL(xpt2046)');
      expect(code.includes.join('\n')).toContain('zephyr/drivers/spi.h');
    });

    it('uses the standard XPT2046 control bytes', () => {
      // 0x90 X, 0xD0 Y, 0xB0 Z1 (12-bit differential mode).
      expect(code.functions).toContain('__tc_xpt_read(0xB0)');
      expect(code.functions).toContain('__tc_xpt_read(0x90)');
      expect(code.functions).toContain('__tc_xpt_read(0xD0)');
    });

    it('extracts the 12-bit result with an explicit shift, no C casts', () => {
      expect(code.functions).toContain('>> 3');
      expect(code.functions).not.toMatch(/\(uint16_t\)\s*__/);
    });

    it('defaults the Z1 pen threshold to the Arduino library value', () => {
      expect(code.functions).toContain('__z1 <= 400');
    });

    it('honors an explicit minPressure threshold', () => {
      const tuned = zephyrTouchAdapter({
        library: 'XPT2046_Touchscreen', minPressure: 350,
        calibration: { xMin: 0, xMax: 4095, yMin: 0, yMax: 4095 },
      })!;
      expect(tuned.functions).toContain('__z1 <= 350');
    });

    it('gates the pen IRQ path on the DT int-gpios property', () => {
      expect(code.declaration).toContain(
        '#if DT_NODE_HAS_PROP(DT_NODELABEL(xpt2046), int_gpios)',
      );
      expect(code.functions).toContain('gpio_pin_get_dt(&__tc_touch_irq)');
    });
  });

  describe('FT6336U (capacitive) on the input subsystem', () => {
    const code = zephyrTouchAdapter({
      library: 'FT6336U',
      calibration: { xMin: 0, xMax: 320, yMin: 0, yMax: 240 },
    })!;

    it('emits the three ui_poll_touch symbols', () => {
      expect(code.functions).toContain('touch_init()');
      expect(code.functions).toContain('touch_isTouched()');
      expect(code.functions).toContain('touch_readRaw(');
    });

    it('listens for the driver input events, owns no bus', () => {
      // The in-tree focaltech driver polls the controller; this adapter only
      // consumes its events (ABS position + BTN_TOUCH press state).
      expect(code.functions).toContain('INPUT_CALLBACK_DEFINE(DEVICE_DT_GET(DT_NODELABEL(ft6336u)), __tc_touch_input_cb, NULL)');
      expect(code.functions).toContain('evt->code == INPUT_ABS_X');
      expect(code.functions).toContain('evt->code == INPUT_BTN_TOUCH');
      // No raw I2C/SPI traffic in the emitted adapter anymore, except the
      // TEMPORARY TD_STATUS diagnostic probe (removed after root-cause).
      expect(code.functions).not.toContain('spi_transceive');
      expect(code.includes.join('\n')).not.toContain('zephyr/drivers/spi.h');
    });

    it('drives the touch power enable with the rig-verified sequence', () => {
      // GPIO4 on the rig: LOW 10ms → HIGH → 500ms settle. Without it the
      // controller half-powers off a floating enable and the bus dies.
      expect(code.functions).toContain('GPIO_DT_SPEC_GET(DT_NODELABEL(ft6336u), reset_gpios)');
      expect(code.functions).toContain('GPIO_OUTPUT_ACTIVE);   // drive LOW (active-low spec)');
      expect(code.functions).toContain('k_msleep(10);');
      expect(code.functions).toContain('k_msleep(500);');
    });

    it('keeps the raw register coordinate space for ui_poll_touch', () => {
      // touch_readRaw hands through the event values untouched — the
      // runtime's calibration + rotation math is unchanged from the raw
      // register-polling adapter (the swapped-xy DT prop normalizes the
      // driver's axis swap).
      expect(code.functions).toContain('*x = __tc_touch_cached_x;');
      expect(code.functions).toContain('*y = __tc_touch_cached_y;');
      expect(code.functions).toContain('*z = 255;');
      expect(code.functions).not.toContain('nativeWidth');
    });
  });
});
