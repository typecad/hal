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
    const txt = generateOverlay(XIAO_BLE, { usesDisplay: true }, DEFAULT_ZEPHYR_DISPLAY_PROFILE);
    expect(txt).toContain('&display0');
    expect(txt).toContain('status = "okay"');
  });

  it('omits unused peripherals', () => {
    const txt = generateOverlay(XIAO_BLE, { usesI2c: false }, undefined);
    expect(txt).not.toContain('&spi2');
  });

  it('has a header comment marking it auto-generated', () => {
    const txt = generateOverlay(XIAO_BLE, {}, undefined);
    expect(txt).toContain('Auto-generated');
  });
});
