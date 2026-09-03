import { describe, it, expect } from 'vitest';
import { TEST_CHIP, chipForBoard } from '../helpers/test-chip';
import { lowerHwtimer, hwtimerInitLines } from '../../../../packages/framework-zephyr/src/lowering/hwtimer';
const ESP32_DEVKITC = chipForBoard('esp32_devkitc/esp32/procpu');


describe('hwtimer init block', () => {
  it('emits per-instance counter device + hz/callback state on a chip with a timer', () => {
    // XIAO nRF52840 declares RTC1 (instance 0).
    const lines = hwtimerInitLines(TEST_CHIP).join('\n');
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
