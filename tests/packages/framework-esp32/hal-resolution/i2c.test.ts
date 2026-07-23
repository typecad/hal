import { describe, it, expect, beforeEach } from 'vitest';
import { lowerI2c, i2cInitLines } from '../../../../packages/framework-esp32/src/lowering/i2c';
import { setActiveChip, ESP32 } from '../../../../packages/framework-esp32/src/chips/index';

beforeEach(() => setActiveChip(ESP32));

describe('i2c init block', () => {
  it('emits CUTTLEFISH_I2C markers', () => {
    const lines = i2cInitLines(0).join('\n');
    expect(lines).toContain('// CUTTLEFISH_I2C_BEGIN');
    expect(lines).toContain('// CUTTLEFISH_I2C_END');
  });
  it('creates a device handle and fetches the shared bus', () => {
    // The bus handle itself lives in the shared store (i2c-bus-store.ts) so
    // every I2C consumer shares one i2c_new_master_bus() per controller. The
    // init block holds this consumer's device handle and calls the getter —
    // it never constructs the bus itself, only fetches it.
    const lines = i2cInitLines(0).join('\n');
    expect(lines).toMatch(/__tc_i2c0_dev/);
    expect(lines).toMatch(/__esp32_i2c_bus_get\(0\)/);
    // No i2c_new_master_bus *call* on a real code line. (The explanatory
    // comment names the function, so strip comments before checking.)
    const codeOnly = lines.replace(/\/\/[^\n]*/g, '');
    expect(codeOnly).not.toMatch(/i2c_new_master_bus\s*\(/);
  });
});

describe('i2c lowering', () => {
  it('begin → __tc_i2c0_init()', () => {
    expect(lowerI2c({ operation: 'i2c.begin', bus: 'I2C0' }))
      .toEqual({ code: '__tc_i2c0_init();' });
  });
  it('begin_transmission adds device then resets txlen', () => {
    // 0x76 === 118 in JS; the lowering emits the numeric value verbatim.
    const out = lowerI2c({ operation: 'i2c.begin_transmission', bus: 'I2C0', address: 0x76 }).code!;
    expect(out).toContain('i2c_master_bus_add_device');
    expect(out).toContain('.device_address = 118');
    expect(out).toContain('__tc_i2c0_addr');
    expect(out).toContain('__tc_i2c0_txlen = 0');
  });
  it('write buffers a byte', () => {
    expect(lowerI2c({ operation: 'i2c.write', bus: 'I2C0', data: '0xAA' }).code)
      .toBe('__tc_i2c0_txbuf[__tc_i2c0_txlen++] = (0xAA);');
  });
  it('write_bytes buffers multiple', () => {
    const out = lowerI2c({ operation: 'i2c.write_bytes', bus: 'I2C0', bytes: [1, 2, 3] }).code!;
    expect(out.match(/__tc_i2c0_txbuf\[/g)?.length).toBe(3);
    expect(out).toContain('(1)');
    expect(out).toContain('(3)');
  });
  it('end_transmission flushes via i2c_master_transmit', () => {
    expect(lowerI2c({ operation: 'i2c.end_transmission', bus: 'I2C0', stop: true }).code)
      .toBe('i2c_master_transmit(__tc_i2c0_dev, __tc_i2c0_txbuf, __tc_i2c0_txlen, -1);');
  });
  it('request_from reads and resets rxpos', () => {
    const out = lowerI2c({ operation: 'i2c.request_from', bus: 'I2C0', address: 0x76, quantity: 4, stop: false }).code!;
    expect(out).toContain('i2c_master_receive');
    expect(out).toContain('__tc_i2c0_rxlen = 4');
  });
  it('available → remaining bytes expression', () => {
    expect(lowerI2c({ operation: 'i2c.available', bus: 'I2C0' }).expression)
      .toBe('(__tc_i2c0_rxlen - __tc_i2c0_rxpos)');
  });
  it('read → rxbuf indexed expression', () => {
    expect(lowerI2c({ operation: 'i2c.read', bus: 'I2C0' }).expression)
      .toBe('__tc_i2c0_rxbuf[__tc_i2c0_rxpos++]');
  });
  it('unknown i2c.* op throws', () => {
    expect(() => lowerI2c({ operation: 'i2c.unknown', bus: 'I2C0' } as any)).toThrow(/does not yet support/);
  });
});
