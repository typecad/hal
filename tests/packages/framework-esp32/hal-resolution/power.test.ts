import { describe, it, expect } from 'vitest';
import { lowerPower, powerInitLines } from '../../../../packages/framework-esp32/src/lowering/power';

describe('power init block', () => {
  it('emits CUTTLEFISH_POWER markers (no runtime init)', () => {
    const lines = powerInitLines().join('\n');
    expect(lines).toContain('// CUTTLEFISH_POWER_BEGIN');
    expect(lines).toContain('// CUTTLEFISH_POWER_END');
  });
});

describe('power lowering', () => {
  it('deep_sleep converts ms to us via timer wakeup', () => {
    const out = lowerPower({ operation: 'power.deep_sleep', ms: 5000 }).code!;
    expect(out).toContain('esp_sleep_enable_timer_wakeup');
    expect(out).toContain('5000');
    expect(out).toContain('* 1000');
    expect(out).toContain('esp_deep_sleep_start');
  });
  it('light_sleep → esp_light_sleep_start', () => {
    expect(lowerPower({ operation: 'power.light_sleep' }))
      .toEqual({ code: 'esp_light_sleep_start();' });
  });
  it('set_cpu_frequency uses esp_pm_configure with chip-specific struct', () => {
    const out = lowerPower({ operation: 'power.set_cpu_frequency', mhz: 160 }).code!;
    expect(out).toContain('esp_pm_configure');
    expect(out).toContain('esp_pm_config_esp32_t');
    expect(out).toContain('.max_freq_mhz = 160');
    expect(out).toContain('.min_freq_mhz = 160');
  });
  it('unknown power.* op throws', () => {
    expect(() => lowerPower({ operation: 'power.unknown' } as any)).toThrow(/does not yet support/);
  });
});
