import { describe, it, expect, beforeEach } from 'vitest';
import { lowerSpi, spiInitLines } from '../../../../packages/framework-esp32/src/lowering/spi';
import { setActiveChip, ESP32 } from '../../../../packages/framework-esp32/src/chips/index';

beforeEach(() => setActiveChip(ESP32));

describe('spi init block', () => {
  it('emits CUTTLEFISH_SPI markers', () => {
    const lines = spiInitLines(0).join('\n');
    expect(lines).toContain('// CUTTLEFISH_SPI_BEGIN');
    expect(lines).toContain('// CUTTLEFISH_SPI_END');
  });
  it('calls spi_bus_initialize', () => {
    expect(spiInitLines(0).join('\n')).toMatch(/spi_bus_initialize/);
  });
});

describe('spi lowering', () => {
  it('begin → __tc_spi0_init()', () => {
    expect(lowerSpi({ operation: 'spi.begin', bus: 'SPI0' }))
      .toEqual({ code: '__tc_spi0_init();' });
  });
  it('begin_transaction adds device on first call', () => {
    const out = lowerSpi({ operation: 'spi.begin_transaction', bus: 'SPI0', settings: 'SPISettings(4000000, MSBFIRST, SPI_MODE0)' }).code!;
    expect(out).toContain('spi_bus_add_device');
    expect(out).toContain('clock_speed_hz');
  });
  it('cs_low drives GPIO low', () => {
    expect(lowerSpi({ operation: 'spi.cs_low', pin: 5 }))
      .toEqual({ code: 'gpio_set_level((gpio_num_t)5, 0);' });
  });
  it('cs_high drives GPIO high', () => {
    expect(lowerSpi({ operation: 'spi.cs_high', pin: 5 }))
      .toEqual({ code: 'gpio_set_level((gpio_num_t)5, 1);' });
  });
  it('transfer returns rx byte via expression', () => {
    const out = lowerSpi({ operation: 'spi.transfer', bus: 'SPI0', data: '0xFF' }).expression!;
    expect(out).toContain('spi_device_polling_transmit');
    expect(out).toContain('0xFF');
  });
  it('end removes device and frees bus', () => {
    const out = lowerSpi({ operation: 'spi.end', bus: 'SPI0' }).code!;
    expect(out).toContain('spi_bus_remove_device');
    expect(out).toContain('spi_bus_free');
  });
  it('unknown spi.* op throws', () => {
    expect(() => lowerSpi({ operation: 'spi.unknown', bus: 'SPI0' } as any)).toThrow(/does not yet support/);
  });
});
