import { describe, it, expect } from 'vitest';
import { lowerWdt, wdtInitLines } from '../../../../packages/framework-esp32/src/lowering/wdt';

describe('wdt init block', () => {
  it('emits CUTTLEFISH_WDT markers + esp_task_wdt_init', () => {
    const lines = wdtInitLines().join('\n');
    expect(lines).toContain('// CUTTLEFISH_WDT_BEGIN');
    expect(lines).toContain('// CUTTLEFISH_WDT_END');
    expect(lines).toContain('esp_task_wdt_init');
    expect(lines).toContain('esp_task_wdt_add(NULL)');
  });
});

describe('wdt lowering', () => {
  it('enable with timeout calls __tc_wdt_init', () => {
    expect(lowerWdt({ operation: 'wdt.enable', timeout: 5000 }))
      .toEqual({ code: '__tc_wdt_init(5000);' });
  });
  it('enable with duration string passes through', () => {
    expect(lowerWdt({ operation: 'wdt.enable', timeout: '250ms' }).code)
      .toContain('__tc_wdt_init(250ms)');
  });
  it('reset → esp_task_wdt_reset', () => {
    expect(lowerWdt({ operation: 'wdt.reset' }))
      .toEqual({ code: 'esp_task_wdt_reset();' });
  });
  it('disable → delete + deinit', () => {
    const out = lowerWdt({ operation: 'wdt.disable' }).code!;
    expect(out).toContain('esp_task_wdt_delete(NULL)');
    expect(out).toContain('esp_task_wdt_deinit');
  });
  it('unknown wdt.* op throws', () => {
    expect(() => lowerWdt({ operation: 'wdt.unknown' } as any)).toThrow(/does not yet support/);
  });
});
