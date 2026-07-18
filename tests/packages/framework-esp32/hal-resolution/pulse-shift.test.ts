import { describe, it, expect } from 'vitest';
import { lowerPulse, lowerShift, pulseShiftInitLines } from '../../../../packages/framework-esp32/src/lowering/pulse-shift';

describe('pulse-shift init block', () => {
  it('emits CUTTLEFISH_PULSE + CUTTLEFISH_SHIFT markers', () => {
    const lines = pulseShiftInitLines().join('\n');
    expect(lines).toContain('// CUTTLEFISH_PULSE_BEGIN');
    expect(lines).toContain('// CUTTLEFISH_PULSE_END');
    expect(lines).toContain('// CUTTLEFISH_SHIFT_BEGIN');
    expect(lines).toContain('// CUTTLEFISH_SHIFT_END');
  });
  it('declares __tc_pulse_in, __tc_shift_in, __tc_shift_out', () => {
    const lines = pulseShiftInitLines().join('\n');
    expect(lines).toContain('__tc_pulse_in');
    expect(lines).toContain('__tc_shift_in');
    expect(lines).toContain('__tc_shift_out');
  });
});

describe('pulse lowering', () => {
  it('pulse.in returns expression with default timeout', () => {
    expect(lowerPulse({ operation: 'pulse.in', pin: 5, value: 1 }))
      .toEqual({ expression: '__tc_pulse_in(5, 1, 1000000)' });
  });
  it('pulse.in with explicit timeout', () => {
    expect(lowerPulse({ operation: 'pulse.in', pin: 5, value: 1, timeout: 50000 }))
      .toEqual({ expression: '__tc_pulse_in(5, 1, 50000)' });
  });
  it('pulse.in_long uses larger default timeout', () => {
    expect(lowerPulse({ operation: 'pulse.in_long', pin: 5, value: 0 }).expression)
      .toContain('100000000');
  });
  it('unknown pulse.* op throws', () => {
    expect(() => lowerPulse({ operation: 'pulse.unknown', pin: 5 } as any)).toThrow(/does not yet support/);
  });
});

describe('shift lowering', () => {
  it('shift.in lsb → bitOrder=0', () => {
    expect(lowerShift({ operation: 'shift.in', dataPin: 2, clockPin: 3, bitOrder: 'lsb' }))
      .toEqual({ expression: '__tc_shift_in(2, 3, 0)' });
  });
  it('shift.in msb → bitOrder=1', () => {
    expect(lowerShift({ operation: 'shift.in', dataPin: 2, clockPin: 3, bitOrder: 'msb' }))
      .toEqual({ expression: '__tc_shift_in(2, 3, 1)' });
  });
  it('shift.out lsb → code with value', () => {
    // 0xAA === 170 in JS; the lowering emits the numeric value verbatim.
    expect(lowerShift({ operation: 'shift.out', dataPin: 2, clockPin: 3, bitOrder: 'lsb', value: 0xAA }))
      .toEqual({ code: '__tc_shift_out(2, 3, 0, 170);' });
  });
  it('unknown shift.* op throws', () => {
    expect(() => lowerShift({ operation: 'shift.unknown' } as any)).toThrow(/does not yet support/);
  });
});
