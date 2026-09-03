import { describe, it, expect } from 'vitest';
import { TEST_CHIP } from '../helpers/test-chip';
import { lowerWdt, wdtInitLines } from '../../../../packages/framework-zephyr/src/lowering/wdt';

// A wdt-less chip (the Nano 33 IoT / SAM D21 shape — Zephyr's samd21.dtsi
// exposes no watchdog node, so its descriptor carries no wdt entry). Built
// by stripping wdt from a real descriptor rather than importing a second
// chip module.
const NO_WDT_CHIP = { ...TEST_CHIP, id: 'nano_33_iot_samd21', wdt: undefined };

describe('wdt init block', () => {
  it('emits CUTTLEFISH_WDT markers + the wdt0 device + channel state', () => {
    const lines = wdtInitLines(TEST_CHIP).join('\n');
    expect(lines).toContain('// CUTTLEFISH_WDT_BEGIN');
    expect(lines).toContain('// CUTTLEFISH_WDT_END');
    expect(lines).toContain('DEVICE_DT_GET(DT_NODELABEL(wdt0))');
    expect(lines).toContain('static int __tc_wdt_channel = -1;');
  });
});

describe('wdt lowering', () => {





  it('disable → wdt_disable + reset setup flag', () => {
    expect(lowerWdt({ operation: 'wdt.disable' } as any, TEST_CHIP))
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
