import { describe, it, expect, afterEach } from 'vitest';
import { lowerPower, powerInitLines } from '../../../../packages/framework-esp32/src/lowering/power';
import { setActiveChip, ESP32, ESP32C3 } from '../../../../packages/framework-esp32/src/chips/index';

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

describe('power lowering — deep_sleep_pin', () => {
  afterEach(() => setActiveChip(ESP32));

  it('on Xtensa (ESP32) lowers to ext0 wakeup + rtc_gpio_init + deep sleep', () => {
    setActiveChip(ESP32);
    const out = lowerPower({ operation: 'power.deep_sleep_pin', pin: 32, level: 0 }).code!;
    // ext0 is the single-RTC-pin wakeup path on classic ESP32 / S3.
    expect(out).toContain('esp_sleep_enable_ext0_wakeup');
    expect(out).toContain('rtc_gpio_init');
    expect(out).toContain('(gpio_num_t)32');
    expect(out).toContain('esp_deep_sleep_start');
  });

  it('on RISC-V (C3) lowers to gpio_wakeup (no ext0/ext1)', () => {
    setActiveChip(ESP32C3);
    const out = lowerPower({ operation: 'power.deep_sleep_pin', pin: 4, level: 1 }).code!;
    // C3/C6 have no ext0/ext1; they use the gpio_wakeup variant.
    expect(out).toContain('esp_sleep_enable_gpio_wakeup');
    expect(out).not.toContain('ext0');
    expect(out).toContain('esp_deep_sleep_start');
    // level 1 → GPIO_HIGH
    expect(out).toContain('ESP_GPIO_WAKEUP_GPIO_HIGH');
  });

  it('on C3 level 0 → GPIO_LOW', () => {
    setActiveChip(ESP32C3);
    const out = lowerPower({ operation: 'power.deep_sleep_pin', pin: 0, level: 0 }).code!;
    expect(out).toContain('ESP_GPIO_WAKEUP_GPIO_LOW');
  });
});
