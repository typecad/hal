import { describe, it, expect } from 'vitest';
import { lowerI2c, i2cInitLines } from '../../../../packages/framework-zephyr/src/lowering/i2c';
import { XIAO_BLE } from '../../../../packages/framework-zephyr/src/chips/xiao-ble';

describe('i2c init block', () => {
  it('emits CUTTLEFISH_I2C markers + the i2c1 device + tx/rx buffers', () => {
    const lines = i2cInitLines(XIAO_BLE, 0).join('\n');
    expect(lines).toContain('// CUTTLEFISH_I2C_BEGIN');
    expect(lines).toContain('// CUTTLEFISH_I2C_END');
    expect(lines).toContain('DEVICE_DT_GET(DT_NODELABEL(i2c1))');
    expect(lines).toContain('__tc_i2c0_txbuf');
    expect(lines).toContain('__tc_i2c0_rxbuf');
  });
});

describe('i2c lowering', () => {
  it('begin → no-op keep-alive referencing the whole controller state block', () => {
    // Zephyr resolves the device at compile time, so begin has nothing to do —
    // but it must (void)-reference every shim variable so a program that only
    // calls begin() stays -Werror clean (Zephyr builds with warnings-as-errors).
    const out = lowerI2c({ operation: 'i2c.begin', bus: 'I2C0' } as any, XIAO_BLE);
    expect(out.code).toContain('(void)__tc_i2c0_dev');
    expect(out.code).toContain('(void)__tc_i2c0_addr');
    expect(out.code).toContain('(void)__tc_i2c0_txbuf');
    expect(out.code).toContain('(void)__tc_i2c0_rxpos');
    // Same shape for end.
    const end = lowerI2c({ operation: 'i2c.end', bus: 'I2C0' } as any, XIAO_BLE);
    expect(end.code).toBe(out.code);
  });

  it('begin_transmission records the address + resets txlen', () => {
    const out = lowerI2c({ operation: 'i2c.begin_transmission', bus: 'I2C0', address: 0x42 } as any, XIAO_BLE);
    expect(out.code).toBe('__tc_i2c0_addr = static_cast<uint16_t>(66); __tc_i2c0_txlen = 0;');
  });

  it('write appends one byte (clamped to capacity)', () => {
    const out = lowerI2c({ operation: 'i2c.write', bus: 'I2C0', data: 0xAA } as any, XIAO_BLE);
    expect(out.code).toContain('__tc_i2c0_txbuf[__tc_i2c0_txlen++] = static_cast<uint8_t>(170)');
    expect(out.code).toContain('if (__tc_i2c0_txlen < 32)');
  });

  it('end_transmission flushes txbuf via i2c_write', () => {
    const out = lowerI2c({ operation: 'i2c.end_transmission', bus: 'I2C0' } as any, XIAO_BLE);
    expect(out.code).toBe('i2c_write(__tc_i2c0_dev, __tc_i2c0_txbuf, __tc_i2c0_txlen, __tc_i2c0_addr);');
  });

  it('request_from reads into rxbuf', () => {
    const out = lowerI2c({ operation: 'i2c.request_from', bus: 'I2C0', address: 0x42, quantity: 4 } as any, XIAO_BLE);
    expect(out.code).toContain('i2c_read(__tc_i2c0_dev, __tc_i2c0_rxbuf, static_cast<uint32_t>(4), static_cast<uint16_t>(66))');
    expect(out.code).toContain('__tc_i2c0_rxlen = 4');
  });

  it('available → rxlen - rxpos (expression)', () => {
    expect(lowerI2c({ operation: 'i2c.available', bus: 'I2C0' } as any, XIAO_BLE))
      .toEqual({ expression: '(__tc_i2c0_rxlen - __tc_i2c0_rxpos)' });
  });

  it('read → next byte or -1 (expression)', () => {
    expect(lowerI2c({ operation: 'i2c.read', bus: 'I2C0' } as any, XIAO_BLE))
      .toEqual({ expression: '(__tc_i2c0_rxpos < __tc_i2c0_rxlen ? __tc_i2c0_rxbuf[__tc_i2c0_rxpos++] : -1)' });
  });

  it('recover → i2c_recover_bus', () => {
    expect(lowerI2c({ operation: 'i2c.recover', bus: 'I2C0' } as any, XIAO_BLE))
      .toEqual({ code: 'i2c_recover_bus(__tc_i2c0_dev);' });
  });
});
