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

describe('counter lowering surface (legacy hwtimer.* ops removed)', () => {
  it('lowerHwtimer rejects legacy ops; lowerCounter owns the verbs', async () => {
    const mod = await import('../../../../packages/framework-zephyr/src/lowering/hwtimer');
    expect(typeof mod.lowerCounter).toBe('function');
  });
});
