import { describe, it, expect } from 'vitest';
import { lowerSpi, spiInitLines } from '../../../../packages/framework-zephyr/src/lowering/spi';
import { XIAO_BLE } from '../../../../packages/framework-zephyr/src/chips/xiao-ble';

describe('spi init block', () => {
  it('emits CUTTLEFISH_SPI markers + the spi2 device + a spi_config', () => {
    const lines = spiInitLines(XIAO_BLE, 0).join('\n');
    expect(lines).toContain('// CUTTLEFISH_SPI_BEGIN');
    expect(lines).toContain('// CUTTLEFISH_SPI_END');
    expect(lines).toContain('DEVICE_DT_GET(DT_NODELABEL(spi2))');
    expect(lines).toContain('SPI_OP_MODE_MASTER | SPI_TRANSFER_MSB | SPI_WORD_SET(8)');
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

  it('set_mode → deferred comment (CPOL/CPHA not applied)', () => {
    const out = lowerSpi({ operation: 'spi.set_mode', bus: 'SPI0', mode: 1 } as any, XIAO_BLE);
    expect(out.code).toContain('deferred');
  });

  it('set_bit_order → deferred comment (fixed MSB)', () => {
    const out = lowerSpi({ operation: 'spi.set_bit_order', bus: 'SPI0', order: 'LSBFIRST' } as any, XIAO_BLE);
    expect(out.code).toContain('fixed SPI_TRANSFER_MSB');
  });
});
