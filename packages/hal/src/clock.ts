// ---------------------------------------------------------------------------
// Clock — wall-clock time over the board's RTC device
//
// Zephyr's rtc alias is the discovery convention: boards with a hardware
// calendar RTC alias it to their node, and every board with a free counter
// can carry one via the zephyr,rtc-counter shim (a CHILD of the counter
// node — the counter driver, and the Counter class with it, keep the
// parent). The generated overlay synthesizes the shim when the board ships
// no alias of its own, so Clock exports wherever a free counter exists —
// the same facts that gate Counter.
//
// v1 semantics: set/now within a power session. Only hardware-calendar
// nodes retain time across power loss (the shim keeps it while its counter
// runs); the doc on set() says which your board has.
// ----------------------------------------------------------------------------

import { clockSet, clockNow } from './emit.js';

class ClockClass {
  static readonly __instance_name = 'Clock';

  /** Set the wall clock to Unix epoch seconds — e.g. the value your build
   *  host stamps, or a time server's answer. On boards whose `rtc` alias
   *  points at a hardware calendar (backup-domain RTC), the time survives
   *  power loss; on counter-backed boards it lives while the counter runs.
   *  Invalid dates cannot occur — the conversion is pure arithmetic. */
  set(epochSeconds: number): void {
    clockSet(epochSeconds);
  }

  /** Read the wall clock as Unix epoch seconds (0 before the first set(),
   *  and after a power loss on counter-backed boards). */
  now(): number {
    return clockNow();
  }
}

/** The wall-clock surface: `Clock.set(1710000000); Clock.now()`. */
export const Clock = new ClockClass();
