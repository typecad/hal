// ---------------------------------------------------------------------------
// Watchdog — the thin Zephyr-shaped watchdog
//
// The timeout is a CONSTRUCTION fact in milliseconds (Zephyr's own unit for
// wdt_timeout_cfg.window.max). enable() arms (wdt_install_timeout +
// wdt_setup, reset-CPU-core flag); feed() keeps it alive (wdt_feed) —
// Zephyr's verbs, no WDTO_* presets, no string parsing.
// ----------------------------------------------------------------------------

import { wdtSetup, wdtFeed, wdtDisable } from './emit.js';

export class Watchdog {
  private readonly _timeoutMs: number;

  /** Construct with the timeout in milliseconds. */
  constructor(timeoutMs: number) {
    this._timeoutMs = timeoutMs;
  }

  /** Arm the watchdog (wdt_install_timeout + wdt_setup). Full CPU reset on
   *  expiry. Call feed() at least once per timeout window afterwards. */
  enable(): void {
    wdtSetup(this._timeoutMs);
  }

  /** Feed the watchdog (wdt_feed). */
  feed(): void {
    wdtFeed();
  }

  /** Disable (wdt_disable). Not all drivers support runtime disable. */
  disable(): void {
    wdtDisable();
  }
}
