// ---------------------------------------------------------------------------
// bus-pins.test.ts — zephyr.buses config parsing (the ESP32 pin-matrix bus
// remux): keys are HAL bus selectors, values are pad records. Each valid
// spec becomes a controller with a synthesized pinctrl group; invalid keys,
// missing paired pins, and non-ESP32 SoCs warn and skip.
// ----------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';
import { parseBusPins } from '../../../packages/framework-zephyr/src/boardgen/bus-pins';

describe('parseBusPins', () => {
  it('synthesizes an I2C controller with the SoC pinctrl macro trio', () => {
    const r = parseBusPins({ i2c0: { sda: 8, scl: 9 } }, 'esp32s3');
    expect(r.warnings).toHaveLength(0);
    expect(r.specs).toHaveLength(1);
    const s = r.specs[0]!;
    expect(s.kind).toBe('i2c');
    expect(s.index).toBe(0);
    expect(s.nodeLabel).toBe('i2c0');
    expect(s.groupName).toBe('i2c0_tc_remux');
    expect(s.include).toContain('esp32s3-pinctrl.h');
    expect(s.include).toContain('esp-pinctrl-common.h');
    expect(s.include).toContain('esp32s3-gpio-sigmap.h');
    expect(s.pinmux).toEqual(['I2C0_SDA_GPIO8', 'I2C0_SCL_GPIO9']);
  });

  it('maps HAL SPI indexes onto the SoC GPSPI nodelabels (SPI0 → spi2)', () => {
    const r = parseBusPins({ spi0: { sck: 12, mosi: 11, miso: 13 } }, 'esp32s3');
    const s = r.specs[0]!;
    expect(s.nodeLabel).toBe('spi2');
    expect(s.pinmux).toEqual(['SPIM2_SCLK_GPIO12', 'SPIM2_MOSI_GPIO11', 'SPIM2_MISO_GPIO13']);
  });

  it('uart needs both tx and rx', () => {
    const r = parseBusPins({ uart1: { tx: 17 } }, 'esp32s3');
    expect(r.specs).toHaveLength(0);
    expect(r.warnings[0]).toContain('both tx and rx');
  });

  it('i2c needs both sda and scl', () => {
    const r = parseBusPins({ i2c0: { sda: 8 } }, 'esp32s3');
    expect(r.specs).toHaveLength(0);
    expect(r.warnings[0]).toContain('both sda and scl');
  });

  it('spi needs at least sck and mosi (miso optional)', () => {
    const ok = parseBusPins({ spi1: { sck: 4, mosi: 5 } }, 'esp32s3');
    expect(ok.specs[0]!.pinmux).toEqual(['SPIM3_SCLK_GPIO4', 'SPIM3_MOSI_GPIO5']);
    const bad = parseBusPins({ spi1: { mosi: 5 } }, 'esp32s3');
    expect(bad.specs).toHaveLength(0);
    expect(bad.warnings[0]).toContain('sck and mosi');
  });

  it('rejects unknown keys with a helpful warning', () => {
    const r = parseBusPins({ can0: { tx: 1 } }, 'esp32s3');
    expect(r.specs).toHaveLength(0);
    expect(r.warnings[0]).toContain('not a bus selector');
  });

  it('non-ESP32 SoCs warn (fixed-pin silicon: pins come from the board DT)', () => {
    const r = parseBusPins({ i2c0: { sda: 8, scl: 9 } }, 'stm32f401xc');
    expect(r.specs).toHaveLength(0);
    expect(r.warnings[0]).toContain('ESP32-family capability');
  });
});
