// ---------------------------------------------------------------------------
// PWM — the thin Zephyr-shaped PWM channel
//
// The period is a CONSTRUCTION fact (Zephyr's model — the period lives with
// the channel, not with each write): `new PWM(PA5, { periodNs: 20_000_000 })`.
// The first use applies the construction period (pwm_set_dt with an idle
// pulse — Zephyr 4.4 has no period-only setter), then setPulse lowers to
// pwm_set_pulse_dt verbatim. setDuty(0.0–1.0) is sugar that lowers to
// exactly one pwm_set_pulse_dt against the known period — no 0–255 scaling
// anywhere. Nanoseconds throughout.
// ----------------------------------------------------------------------------

import { pwmSetPulse, pwmSetDuty, pwmSetPeriod } from './emit.js';
import type { Pin } from './gpio.js';

/**
 * A PWM output channel: `new PWM(PA5, { periodNs: 20_000_000 })`. The
 * period belongs to the channel and is set at construction;
 * `setPulse(pulseNs)` sets the pulse width in nanoseconds and
 * `setDuty(0.0–1.0)` sets it as a fraction of the period. All values are
 * nanoseconds — 50 Hz servo = 20_000_000, 1 kHz LED dimming = 1_000_000.
 */
export class PWM {
  private readonly _pin: number;
  private readonly _periodNs: number;
  // Routing overrides (the inline escape hatch): the DT controller nodelabel
  // and channel for pins the facts layer does not cover.
  private readonly _controller: string;
  private readonly _channel: number;

  /** Construct a PWM channel. `periodNs` is required — the channel's period
   *  in nanoseconds (50 Hz servo = 20_000_000; 1 kHz LED dimming =
   *  1_000_000). `controller`/`channel` are manual routing overrides for
   *  pins the board data doesn't cover. */
  constructor(
    pin: number | Pin,
    opts: { periodNs: number; controller?: string; channel?: number },
  ) {
    this._pin = typeof pin === 'number' ? pin : pin.number;
    this._periodNs = opts.periodNs;
    this._controller = opts?.controller ?? '';
    this._channel = opts?.channel ?? -1;
  }

  /** Set the pulse width in nanoseconds — the active time within each
   *  period. */
  setPulse(pulseNs: number): void {
    pwmSetPulse(this._pin, this._periodNs, pulseNs, this._controller, this._channel);
  }

  /** Set the duty cycle as a fraction of the period: 0.0 = always off,
   *  1.0 = always on. */
  setDuty(duty: number): void {
    pwmSetDuty(this._pin, this._periodNs, duty, this._controller, this._channel);
  }

  /** Change the period at runtime. The output goes idle until the next
   *  setPulse/setDuty call — follow this with one of them. */
  setPeriod(periodNs: number): void {
    pwmSetPeriod(this._pin, periodNs, this._controller, this._channel);
  }
}
