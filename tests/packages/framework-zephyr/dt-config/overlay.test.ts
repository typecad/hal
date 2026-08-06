import { describe, it, expect } from 'vitest';
import { generateOverlay } from '../../../../packages/framework-zephyr/src/dt-config/overlay';
import { XIAO_BLE } from '../../../../packages/framework-zephyr/src/chips/xiao-ble';
import { DEFAULT_ZEPHYR_DISPLAY_PROFILE } from '../../../../packages/framework-zephyr/src/display/profiles';

describe('generateOverlay', () => {
  it('enables used peripherals with status okay', () => {
    const txt = generateOverlay(XIAO_BLE, { usesI2c: true, usesSpi: true }, undefined);
    expect(txt).toContain('&i2c1');
    expect(txt).toContain('&spi2');
    expect(txt).toContain('status = "okay"');
  });

  it('enables the display node when a profile is passed', () => {
    // The display node is emitted as a full / { mipi-dbi { display0: display@0 } }
    // definition (boards have no display node to enable with &display0), so assert
    // on the label + compatible rather than a &display0 reference.
    const txt = generateOverlay(XIAO_BLE, { usesDisplay: true }, DEFAULT_ZEPHYR_DISPLAY_PROFILE);
    expect(txt).toContain('display0: display@0');
    expect(txt).toContain('compatible = "sitronix,st7796s"');
  });

  it('omits unused peripherals', () => {
    const txt = generateOverlay(XIAO_BLE, { usesI2c: false }, undefined);
    expect(txt).not.toContain('&spi2');
  });

  it('has a header comment marking it auto-generated', () => {
    const txt = generateOverlay(XIAO_BLE, {}, undefined);
    expect(txt).toContain('Auto-generated');
  });

  it('omits the backlight node when no backlightPin is configured', () => {
    // A panel whose backlight is hardwired to power must not emit a backlight
    // gpio-leds node or alias — doing so would steal a GPIO (demo-st's
    // hardcoded pin 4 previously collided with the FT6336U reset-gpios).
    const txt = generateOverlay(
      XIAO_BLE, { usesDisplay: true }, DEFAULT_ZEPHYR_DISPLAY_PROFILE,
    );
    expect(txt).not.toContain('bl_led');
    expect(txt).not.toContain('bl-gpio-leds');
    expect(txt).not.toContain('backlight = &bl_led');
  });

  it('emits the backlight node on the configured pin when backlightPin is set', () => {
    const txt = generateOverlay(
      XIAO_BLE, { usesDisplay: true }, DEFAULT_ZEPHYR_DISPLAY_PROFILE,
      { backlightPin: 33 },
    );
    expect(txt).toContain('backlight = &bl_led');
    expect(txt).toContain('bl-gpio-leds');
    // Pin 33 is on gpio1 (ESP32-S3: 32-48 → gpio1).
    expect(txt).toContain('gpios = <&gpio1 33 GPIO_ACTIVE_HIGH>');
  });
});
