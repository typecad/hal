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

/**
 * A hardware timer with a repeating alarm: `const c = new Counter(0, { hz:
 * 10 }); c.onAlarm(() => { ... }); c.start();` fires the handler 10 times
 * per second. The instance index picks one of the chip's free hardware
 * timers (0 = the first; a build error lists what the board has). For
 * deterministic sub-millisecond timing this is the tool — Time's clocks
 * are millisecond-resolution.
 */
export class Counter {
  private readonly _instance: number;
  private readonly _hz: number;

  /** Construct a timer handle. `hz` is the alarm frequency — how many
   *  times per second the handler fires. */
  constructor(instance: number, opts: { hz: number }) {
    this._instance = instance;
    this._hz = opts.hz;
  }

  /** Register the handler that fires on each alarm. */
  onAlarm(handler: () => void): void {
    counterOnAlarm(this._instance, callback(handler));
  }

  /** Start the timer — the handler fires at the constructed rate. */
  start(): void {
    counterStart(this._instance, this._hz);
  }

  /** Stop the timer. */
  stop(): void {
    counterStop(this._instance);
  }
}
