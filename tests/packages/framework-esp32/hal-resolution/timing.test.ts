import { describe, it, expect } from 'vitest';
import { lowerTiming } from '../../../../packages/framework-esp32/src/lowering/timing';

describe('timing lowering', () => {
  it('delay → vTaskDelay(pdMS_TO_TICKS)', () => {
    expect(lowerTiming({ operation: 'timing.delay', ms: 500 }))
      .toEqual({ code: 'vTaskDelay(pdMS_TO_TICKS(500));' });
  });
  it('delay_microseconds → esp_rom_delay_us', () => {
    expect(lowerTiming({ operation: 'timing.delay_microseconds', us: 10 }))
      .toEqual({ code: 'esp_rom_delay_us(10);' });
  });
  it('millis → esp_timer_get_time / 1000 (expression)', () => {
    expect(lowerTiming({ operation: 'timing.millis' }))
      .toEqual({ expression: '(esp_timer_get_time() / 1000)' });
  });
  it('micros → esp_timer_get_time (expression)', () => {
    expect(lowerTiming({ operation: 'timing.micros' }))
      .toEqual({ expression: 'esp_timer_get_time()' });
  });
  it('free_heap → esp_get_free_heap_size (expression)', () => {
    expect(lowerTiming({ operation: 'timing.free_heap' }))
      .toEqual({ expression: 'esp_get_free_heap_size()' });
  });
  it('set_interval defers to polyfill (throws from direct lowering)', () => {
    expect(() => lowerTiming({ operation: 'timing.set_interval' } as any)).toThrow(/polyfill/);
  });
  it('set_timeout defers to polyfill (throws from direct lowering)', () => {
    expect(() => lowerTiming({ operation: 'timing.set_timeout' } as any)).toThrow(/polyfill/);
  });
  it('unknown timing.* op throws', () => {
    expect(() => lowerTiming({ operation: 'timing.unknown' } as any)).toThrow(/does not yet support/);
  });
});
