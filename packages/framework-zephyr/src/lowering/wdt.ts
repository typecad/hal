// ---------------------------------------------------------------------------
// WDT lowering — nRF watchdog via wdt0
//
// Zephyr's WDT API: install a timeout (before setup), then setup, then feed
// periodically. The lowering caches the channel id returned by
// wdt_install_timeout in a static var so wdt.reset can feed it.
//
// enable(timeout): wdt_install_timeout + wdt_setup. Zephyr expects the timeout
// in milliseconds (wdt_window.max); the thin Watchdog (hal/watchdog.ts)
// construction already carries a plain timeoutMs number.
// ---------------------------------------------------------------------------

import type { HALOpIR } from '@typecad/cuttlefish/api/shared';
import type { ZephyrChipDescriptor } from '../chips/types.js';

/**
 * Emit the WDT device + channel state. Called from shimLines when the program
 * uses the watchdog.
 */
export function wdtInitLines(chip: ZephyrChipDescriptor): string[] {
  const nodeLabel = chip.wdt?.nodeLabel ?? 'wdt0';
  return [
    '// CUTTLEFISH_WDT_BEGIN',
    `static const struct device* __tc_wdt_dev = DEVICE_DT_GET(DT_NODELABEL(${nodeLabel}));`,
    'static int __tc_wdt_channel = -1;',
    'static bool __tc_wdt_setup_done = false;',
    '// CUTTLEFISH_WDT_END',
  ];
}

/**
 * Resolve a HAL wdt.* op to Zephyr C++.
 * Returns `{ code }` for statement ops, `{ expression }` for value-returning ops.
 */
export function lowerWdt(op: HALOpIR, chip: ZephyrChipDescriptor): { code?: string; expression?: string } {
  const o = op as any;

  // No watchdog node on this target (e.g. SAM D21 — Zephyr's samd21 dtsi
  // exposes none). Comment + (in profileDiagnostics) a clear error, mirroring
  // the hwtimer unavailable pattern. Without this the wdt_* calls reference
  // the shim vars that wdtInitLines (gated on chip.wdt) never emitted.
  if (!chip.wdt) {
    return { code: `/* ${op.operation}: no watchdog device on ${chip.id} */` };
  }

  switch (op.operation) {
    case 'wdt.setup': {
      // Same install+setup sequence as wdt.enable, but the timeout is a
      // plain ms number from construction — no WDTO_*/string parsing.
      const ms = Number(o.timeoutMs ?? 1000);
      return {
        code: [
          `if (!__tc_wdt_setup_done) {`,
          `    const struct wdt_timeout_cfg __cfg = { .window = { .min = 0, .max = ${ms} }, .callback = NULL, .flags = WDT_FLAG_RESET_CPU_CORE };`,
          `    __tc_wdt_channel = wdt_install_timeout(__tc_wdt_dev, &__cfg);`,
          `    wdt_setup(__tc_wdt_dev, WDT_OPT_PAUSE_HALTED_BY_DBG);`,
          `    __tc_wdt_setup_done = true;`,
          `}`,
        ].join(' '),
      };
    }
    case 'wdt.feed':
      return { code: `if (__tc_wdt_channel >= 0) { wdt_feed(__tc_wdt_dev, __tc_wdt_channel); }` };
    case 'wdt.disable':
      return { code: `wdt_disable(__tc_wdt_dev); __tc_wdt_setup_done = false;` };
    default:
      throw new Error(
        `framework-zephyr does not yet support HAL op \`${op.operation}\`. ` +
          `Open an issue or use rawCpp() to emit it manually.`,
      );
  }
}
