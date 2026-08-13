import { describe, it, expect } from 'vitest';
import { lowerHwtimer, hwtimerInitLines } from '../../../../packages/framework-zephyr/src/lowering/hwtimer';
import { XIAO_BLE } from '../../../../packages/framework-zephyr/src/chips/xiao-ble';
import { ESP32_DEVKITC } from '../../../../packages/framework-zephyr/src/chips/esp32';

describe('hwtimer init block', () => {
  it('emits per-instance counter device + hz/callback state on a chip with a timer', () => {
    // XIAO nRF52840 declares RTC1 (instance 0).
    const lines = hwtimerInitLines(XIAO_BLE).join('\n');
    expect(lines).toContain('// CUTTLEFISH_HWTIMER_BEGIN');
    expect(lines).toContain('// CUTTLEFISH_HWTIMER_END');
    expect(lines).toContain('DEVICE_DT_GET(DT_NODELABEL(rtc1))');
    expect(lines).toContain('__tc_hw_dev_0');
    expect(lines).toContain('__tc_hw_hz_0');
    expect(lines).toContain('__tc_hw_cb_0');
  });

  it('emits nothing on a chip without a free counter', () => {
    expect(hwtimerInitLines(ESP32_DEVKITC)).toEqual([]);
  });
});

describe('hwtimer lowering (XIAO nRF52840 — RTC1 instance 0)', () => {
  it('set_frequency stores the hz value', () => {
    const out = lowerHwtimer({ operation: 'hwtimer.set_frequency', instance: 0, hz: 1000 } as any, XIAO_BLE);
    expect(out.code).toBe('__tc_hw_hz_0 = 1000;');
  });

  it('on_overflow stores the callback', () => {
    const out = lowerHwtimer({ operation: 'hwtimer.on_overflow', instance: 0, handler: 'myHandler' } as any, XIAO_BLE);
    expect(out.code).toBe('__tc_hw_cb_0 = (myHandler);');
  });

  it('start arms the top value + callback, then starts the counter', () => {
    const out = lowerHwtimer({ operation: 'hwtimer.start', instance: 0 } as any, XIAO_BLE);
    expect(out.code).toContain('counter_get_frequency(__tc_hw_dev_0)');
    expect(out.code).toContain('counter_set_top_value(__tc_hw_dev_0');
    expect(out.code).toContain('__tc_hw_cb_0');
    expect(out.code).toContain('counter_start(__tc_hw_dev_0)');
  });

  it('stop halts the counter', () => {
    const out = lowerHwtimer({ operation: 'hwtimer.stop', instance: 0 } as any, XIAO_BLE);
    expect(out.code).toBe('(void)counter_stop(__tc_hw_dev_0);');
  });

  it('accepts a numeric-string instance (the resolver may pre-render it)', () => {
    const out = lowerHwtimer({ operation: 'hwtimer.start', instance: '0' } as any, XIAO_BLE);
    expect(out.code).toContain('__tc_hw_dev_0');
  });
});

describe('hwtimer lowering (chip without a free counter)', () => {
  it('lowers to a "no counter device" comment (probe-tolerant)', () => {
    const out = lowerHwtimer({ operation: 'hwtimer.start', instance: 0 } as any, ESP32_DEVKITC);
    expect(out.code).toContain('no counter device on esp32_devkitc');
  });

  it('out-of-range instance → comment', () => {
    const out = lowerHwtimer({ operation: 'hwtimer.start', instance: 5 } as any, XIAO_BLE);
    expect(out.code).toContain('out of range');
  });
});
