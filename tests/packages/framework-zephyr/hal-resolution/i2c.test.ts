import { describe, it, expect } from 'vitest';
import { TEST_CHIP } from '../helpers/test-chip';
import { lowerI2c, i2cInitLines } from '../../../../packages/framework-zephyr/src/lowering/i2c';

// ── Surviving thin I2C surface (hal/i2c-target.ts). The Wire transaction ops
// were removed with the legacy I2CBus/I2CDevice API; register access is
// i2ctarget's reg_*/dev_write against the shared controller device handle.

describe('thin I2C state block', () => {
  it('emits a bare controller device handle per used instance', () => {
    const lines = i2cInitLines(TEST_CHIP, 0).join('|');
    expect(lines).toContain('__tc_i2c0_dev = DEVICE_DT_GET(DT_NODELABEL(i2c1))');
    expect(lines).not.toContain('_txbuf');
  });
});

describe('thin i2c lowering (reg_* / dev_write)', () => {
  it('reg_write → one i2c_reg_write_byte', () => {
    const out = lowerI2c({ operation: 'i2c.reg_write', bus: 'I2C1', address: 0x44, hz: 0, reg: 0x30, value: 0xA2 } as any, TEST_CHIP);
    expect(out.code).toContain('i2c_reg_write_byte(__tc_i2c1_dev');
  });

  it('construction hz applies once via guarded i2c_configure', () => {
    const out = lowerI2c({ operation: 'i2c.reg_write', bus: 'I2C1', address: 0x44, hz: 400000, reg: 1, value: 2 } as any, TEST_CHIP);
    expect(out.code).toContain('__tc_i2c1_spd_done');
    expect(out.code).toContain('I2C_SPEED_SET(I2C_SPEED_FAST)');
  });

  it('dev_write literal array → one i2c_write', () => {
    const out = lowerI2c({ operation: 'i2c.dev_write', bus: 'I2C1', address: 0x44, hz: 0, bytes: [0x2C, 0x06] } as any, TEST_CHIP);
    expect(out.code).toContain('i2c_write(__tc_i2c1_dev');
  });
});
