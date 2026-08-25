import { describe, it, expect } from 'vitest';
import { lowerWdt, wdtInitLines } from '../../../../packages/framework-zephyr/src/lowering/wdt';
import { XIAO_BLE } from '../../../../packages/framework-zephyr/src/chips/xiao-ble';

// A wdt-less chip (the Nano 33 IoT / SAM D21 shape — Zephyr's samd21.dtsi
// exposes no watchdog node, so its descriptor carries no wdt entry). Built
// by stripping wdt from a real descriptor rather than importing a second
// chip module.
const NO_WDT_CHIP = { ...XIAO_BLE, id: 'nano_33_iot_samd21', wdt: undefined };

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
    const out = lowerWdt({ operation: 'wdt.enable', timeout: 5000 } as any, XIAO_BLE);
    expect(out.code).toContain('.max = 5000');
    expect(out.code).toContain('wdt_install_timeout');
    expect(out.code).toContain('wdt_setup');
    expect(out.code).toContain('WDT_FLAG_RESET_CPU_CORE');
    expect(out.code).toContain('if (!__tc_wdt_setup_done)');
  });

  it('enable with "250ms" string parses to ms', () => {
    const out = lowerWdt({ operation: 'wdt.enable', timeout: '250ms' } as any, XIAO_BLE);
    expect(out.code).toContain('.max = 250');
  });

  it('enable with WDTO_2S Arduino constant parses to ms', () => {
    const out = lowerWdt({ operation: 'wdt.enable', timeout: 'WDTO_2S' } as any, XIAO_BLE);
    expect(out.code).toContain('.max = 2000');
  });

  it('enable with undefined timeout defaults to 1000ms (validator probe)', () => {
    const out = lowerWdt({ operation: 'wdt.enable' } as any, XIAO_BLE);
    expect(out.code).toContain('.max = 1000');
  });

  it('reset → wdt_feed on the cached channel', () => {
    expect(lowerWdt({ operation: 'wdt.reset' } as any, XIAO_BLE))
      .toEqual({ code: 'if (__tc_wdt_channel >= 0) { wdt_feed(__tc_wdt_dev, __tc_wdt_channel); }' });
  });

  it('disable → wdt_disable + reset setup flag', () => {
    expect(lowerWdt({ operation: 'wdt.disable' } as any, XIAO_BLE))
      .toEqual({ code: 'wdt_disable(__tc_wdt_dev); __tc_wdt_setup_done = false;' });
  });
});

describe('wdt lowering (no watchdog on target)', () => {
  // A chip without a wdt entry must lower wdt.* to a comment (never
  // referencing the shim vars wdtInitLines gates on chip.wdt), matching the
  // hwtimer unavailable pattern — otherwise the emitted code references
  // undeclared __tc_wdt_* symbols and fails to compile.
  it('every wdt op lowers to a comment naming the op and the board', () => {
    for (const operation of ['wdt.enable', 'wdt.reset', 'wdt.disable']) {
      const out = lowerWdt({ operation, timeout: '8s' } as any, NO_WDT_CHIP);
      expect(out.code).toMatch(/^\/\* wdt\.(enable|reset|disable): no watchdog device on /);
      expect(out.code).not.toContain('__tc_wdt_dev');
    }
  });
});
