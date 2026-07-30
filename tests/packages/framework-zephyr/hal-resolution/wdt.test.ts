import { describe, it, expect } from 'vitest';
import { lowerWdt, wdtInitLines } from '../../../../packages/framework-zephyr/src/lowering/wdt';
import { XIAO_BLE } from '../../../../packages/framework-zephyr/src/chips/xiao-ble';

describe('wdt init block', () => {
  it('emits CUTTLEFISH_WDT markers + the wdt0 device + channel state', () => {
    const lines = wdtInitLines(XIAO_BLE).join('\n');
    expect(lines).toContain('// CUTTLEFISH_WDT_BEGIN');
    expect(lines).toContain('// CUTTLEFISH_WDT_END');
    expect(lines).toContain('DEVICE_DT_GET(DT_NODELABEL(wdt0))');
    expect(lines).toContain('static int __tc_wdt_channel = -1;');
  });
});

describe('wdt lowering', () => {
  it('enable with numeric timeout (ms) → install + setup once', () => {
    const out = lowerWdt({ operation: 'wdt.enable', timeout: 5000 } as any);
    expect(out.code).toContain('.max = 5000');
    expect(out.code).toContain('wdt_install_timeout');
    expect(out.code).toContain('wdt_setup');
    expect(out.code).toContain('WDT_FLAG_RESET_CPU_CORE');
    expect(out.code).toContain('if (!__tc_wdt_setup_done)');
  });

  it('enable with "250ms" string parses to ms', () => {
    const out = lowerWdt({ operation: 'wdt.enable', timeout: '250ms' } as any);
    expect(out.code).toContain('.max = 250');
  });

  it('enable with WDTO_2S Arduino constant parses to ms', () => {
    const out = lowerWdt({ operation: 'wdt.enable', timeout: 'WDTO_2S' } as any);
    expect(out.code).toContain('.max = 2000');
  });

  it('enable with undefined timeout defaults to 1000ms (validator probe)', () => {
    const out = lowerWdt({ operation: 'wdt.enable' } as any);
    expect(out.code).toContain('.max = 1000');
  });

  it('reset → wdt_feed on the cached channel', () => {
    expect(lowerWdt({ operation: 'wdt.reset' } as any))
      .toEqual({ code: 'if (__tc_wdt_channel >= 0) { wdt_feed(__tc_wdt_dev, __tc_wdt_channel); }' });
  });

  it('disable → wdt_disable + reset setup flag', () => {
    expect(lowerWdt({ operation: 'wdt.disable' } as any))
      .toEqual({ code: 'wdt_disable(__tc_wdt_dev); __tc_wdt_setup_done = false;' });
  });
});
