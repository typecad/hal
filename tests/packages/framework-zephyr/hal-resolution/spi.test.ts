import { describe, it, expect } from 'vitest';
import { lowerSpi, spiInitLines } from '../../../../packages/framework-zephyr/src/lowering/spi';
import { XIAO_BLE } from '../../../../packages/framework-zephyr/src/chips/xiao-ble';

describe('spi init block', () => {
  it('emits markers + spi2 device + spi_config + mutable mode/lsb runtime fields', () => {
    const lines = spiInitLines(XIAO_BLE, 0).join('\n');
    expect(lines).toContain('// CUTTLEFISH_SPI_BEGIN');
    expect(lines).toContain('// CUTTLEFISH_SPI_END');
    expect(lines).toContain('DEVICE_DT_GET(DT_NODELABEL(spi2))');
    // Base operation flags are now built dynamically in _init() from mode/lsb
    // (the static cfg only carries frequency). Assert the components are present.
    expect(lines).toContain('SPI_OP_MODE_MASTER');
    expect(lines).toContain('SPI_WORD_SET(8)');
    // Mutable runtime state for set_mode / set_bit_order.
    expect(lines).toContain('static uint8_t __tc_spi0_mode = 0');
    expect(lines).toContain('static bool __tc_spi0_lsb = false');
    // _init rebuilds operation flags from mode/lsb.
    expect(lines).toContain('SPI_MODE_CPOL');
    expect(lines).toContain('SPI_MODE_CPHA');
    expect(lines).toContain('SPI_TRANSFER_LSB');
  });
});

describe('spi lowering', () => {
  it('begin → spi init helper', () => {
    expect(lowerSpi({ operation: 'spi.begin', bus: 'SPI0' } as any, XIAO_BLE))
      .toEqual({ code: '__tc_spi0_init();' });
  });

  it('transfer → full-duplex single byte, returns rx (expression)', () => {
    const out = lowerSpi({ operation: 'spi.transfer', bus: 'SPI0', data: 0xFF } as any, XIAO_BLE);
    expect(out.expression).toContain('uint8_t __tx = static_cast<uint8_t>(255)');
    expect(out.expression).toContain('spi_transceive(__tc_spi0_dev, &__tc_spi0_cfg');
  });

  it('cs_low → gpio_pin_set_raw 0', () => {
    const out = lowerSpi({ operation: 'spi.cs_low', bus: 'SPI0', pin: 5 } as any, XIAO_BLE);
    expect(out.code).toBe('gpio_pin_set_raw(DEVICE_DT_GET(DT_NODELABEL(gpio0)), 5, 0);');
  });

  it('cs_high → gpio_pin_set_raw 1', () => {
    const out = lowerSpi({ operation: 'spi.cs_high', bus: 'SPI0', pin: 5 } as any, XIAO_BLE);
    expect(out.code).toBe('gpio_pin_set_raw(DEVICE_DT_GET(DT_NODELABEL(gpio0)), 5, 1);');
  });

  it('set_mode → sets __tc_spi_mode + re-inits (applies CPOL/CPHA)', () => {
    const out = lowerSpi({ operation: 'spi.set_mode', bus: 'SPI0', mode: 1 } as any, XIAO_BLE);
    expect(out.code).toContain('__tc_spi0_mode');
    expect(out.code).toContain('__tc_spi0_init()');
  });

  it('set_bit_order → sets __tc_spi_lsb + re-inits (applies LSB/MSB)', () => {
    const out = lowerSpi({ operation: 'spi.set_bit_order', bus: 'SPI0', order: 'LSBFIRST' } as any, XIAO_BLE);
    expect(out.code).toContain('__tc_spi0_lsb');
    expect(out.code).toContain('__tc_spi0_init()');
  });
});
