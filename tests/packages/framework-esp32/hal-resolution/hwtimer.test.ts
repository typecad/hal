import { describe, it, expect } from 'vitest';
import { lowerHwtimer, hwtimerInitLines } from '../../../../packages/framework-esp32/src/lowering/hwtimer';

describe('hwtimer init block', () => {
  it('emits CUTTLEFISH_HWTIMER markers and the GPTimer driver', () => {
    const lines = hwtimerInitLines().join('\n');
    expect(lines).toContain('// CUTTLEFISH_HWTIMER_BEGIN');
    expect(lines).toContain('// CUTTLEFISH_HWTIMER_END');
    expect(lines).toContain('gptimer_new_timer');
    expect(lines).toContain('gptimer_register_event_callbacks');
    expect(lines).toContain('gptimer_start');
    expect(lines).toContain('gptimer_stop');
  });
});

describe('hwtimer lowering', () => {
  it('hwtimer.set_frequency → __tc_hwtimer_set_frequency(inst, hz)', () => {
    const out = lowerHwtimer({ operation: 'hwtimer.set_frequency', instance: 0, hz: 1000 } as any);
    expect(out.code).toBe('__tc_hwtimer_set_frequency(0, 1000);');
  });
  it('hwtimer.on_overflow → __tc_hwtimer_on_overflow(inst, handler)', () => {
    const out = lowerHwtimer({ operation: 'hwtimer.on_overflow', instance: 1, handler: 'onTick' } as any);
    expect(out.code).toBe('__tc_hwtimer_on_overflow(1, onTick);');
  });
  it('hwtimer.start → statement', () => {
    const out = lowerHwtimer({ operation: 'hwtimer.start', instance: 0 } as any);
    expect(out.code).toBe('__tc_hwtimer_start(0);');
  });
  it('hwtimer.stop → statement', () => {
    const out = lowerHwtimer({ operation: 'hwtimer.stop', instance: 0 } as any);
    expect(out.code).toBe('__tc_hwtimer_stop(0);');
  });
  it('unknown hwtimer.* op throws', () => {
    expect(() => lowerHwtimer({ operation: 'hwtimer.bogus' } as any)).toThrow();
  });
});
