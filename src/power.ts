// ---------------------------------------------------------------------------
// Power — explicit power-state entry
//
// The Zephyr model: the CPU node's declared power-states are the facts
// (harvested into zephyr.power.states.*). Light states ("standby",
// "suspend-to-idle") belong to the idle POLICY — the kernel may enter them
// automatically when nothing runs. The deepest state ("soft-off") is
// explicit-entry only, per Zephyr's own devicetree comment ("must be
// entered using pm_state_force() or sys_poweroff() calls only") — that is
// exactly this class's surface.
// ----------------------------------------------------------------------------

import { powerOff, powerOffFor } from './emit.js';

class PowerClass {
  static readonly __instance_name = 'Power';

  /** Enter the deepest power state — deep sleep / soft-off. This call does
   *  not return; the board wakes by reset (the power or EN button) or a
   *  wake source (ESP32: a GPIO armed as a wake trigger; STM32: the WKUP
   *  pin — PA0 on the Black Pill). RAM is not retained; boot starts over.
   *
   *  Expect the console to go silent — that silence IS the effect. */
  off(): void {
    powerOff();
  }

  /** Enter soft-off and wake by the SoC's RTC timer after `ms`
   *  milliseconds — the board reboots on wake (RAM is not retained), so
   *  this is "sleep for N ms, then run from the top". The classic
   *  battery pattern: read sensors, publish, `offFor(60_000)`, repeat —
   *  the SoC draws microamps between wakes.
   *
   *  Rides the RTC wake timer (ESP32 family; the fact is harvested from
   *  the SoC's rtc_timer node — boards without it lower this to a comment
   *  naming the limitation instead of sleeping without a wake source). */
  offFor(ms: number): void {
    powerOffFor(ms);
  }
}

/** The power-state surface: `Power.off()` enters soft-off and never
 *  returns. */
export const Power = new PowerClass();
