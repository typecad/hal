// ---------------------------------------------------------------------------
// Counter — the thin Zephyr-shaped hardware counter/timer
//
// Zephyr's counter driver with Zephyr's verbs. The instance index selects
// one of the chip's declared free counters (instance 0 = the first, e.g.
// RTC1 on the nRF52840; the build errors name the available ones). The alarm
// frequency is a construction fact: start() applies hz as the top value
// (counter_freq / hz) and arms the alarm callback.
// ----------------------------------------------------------------------------

import { counterOnAlarm, counterStart, counterStop } from './emit.js';
import { callback } from './callback.js';

export class Counter {
  private readonly _instance: number;
  private readonly _hz: number;

  /** Construct a counter handle. `hz` is the alarm frequency — start()
   *  realizes it as a top value of counter_freq / hz. */
  constructor(instance: number, opts: { hz: number }) {
    this._instance = instance;
    this._hz = opts.hz;
  }

  /** Register the alarm handler (fires once per top-value wrap). */
  onAlarm(handler: () => void): void {
    counterOnAlarm(this._instance, callback(handler));
  }

  /** Apply hz as the top value, arm the alarm, and start counting
   *  (counter_set_top_value + counter_start). */
  start(): void {
    counterStart(this._instance, this._hz);
  }

  /** Stop counting (counter_stop). */
  stop(): void {
    counterStop(this._instance);
  }
}
