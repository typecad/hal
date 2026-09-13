// ---------------------------------------------------------------------------
// Watchdog — the thin Zephyr-shaped watchdog
//
// The timeout is a CONSTRUCTION fact in milliseconds (Zephyr's own unit for
// wdt_timeout_cfg.window.max). enable() arms (wdt_install_timeout +
// wdt_setup, reset-CPU-core flag); feed() keeps it alive (wdt_feed) —
// Zephyr's verbs, no WDTO_* presets, no string parsing.
// ----------------------------------------------------------------------------

import { wdtSetup, wdtFeed, wdtDisable } from './emit.js';

/**
 * The hardware watchdog: `const w = new Watchdog(10_000); w.enable();`
 * resets the whole board if `feed()` isn't called within every
 * `timeoutMs` window. Typical use: enable once in setup, then feed() from
 * the main loop.
 */
export class Watchdog {
  private readonly _timeoutMs: number;

  /** Construct with the timeout window in milliseconds. */
  constructor(timeoutMs: number) {
    this._timeoutMs = timeoutMs;
  }

  /** Arm the watchdog. If `feed()` isn't called within the timeout
   *  afterwards, the board resets. */
  enable(): void {
    wdtSetup(this._timeoutMs);
  }

  /** Restart the watchdog's countdown — call at least once per timeout
   *  window. */
  feed(): void {
    wdtFeed();
  }

  /** Disarm the watchdog. Not supported on all boards. */
  disable(): void {
    wdtDisable();
  }
}
