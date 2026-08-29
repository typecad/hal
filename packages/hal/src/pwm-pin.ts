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

import { pwmSetPulse, pwmSetDuty, pwmSetPeriod, pwmTone } from './emit.js';
import type { Pin } from './gpio.js';

export class PWM {
  private readonly _pin: number;
  private readonly _periodNs: number;

  /** Construct a PWM channel. `periodNs` is required — the channel's period
   *  in nanoseconds (50 Hz servo = 20_000_000; 1 kHz LED dimming = 1_000_000). */
  constructor(pin: number | Pin, opts: { periodNs: number }) {
    this._pin = typeof pin === 'number' ? pin : pin.number;
    this._periodNs = opts.periodNs;
  }

  /** Set the pulse width in nanoseconds (pwm_set_pulse_dt). */
  setPulse(pulseNs: number): void {
    pwmSetPulse(this._pin, this._periodNs, pulseNs);
  }

  /** Set the duty cycle as a fraction 0.0–1.0. Sugar: lowers to one
   *  pwm_set_pulse_dt with pulse = duty × the constructed period. */
  setDuty(duty: number): void {
    pwmSetDuty(this._pin, this._periodNs, duty);
  }

  /** Change the period at runtime (pwm_set_dt). Zephyr 4.4 has no period-only
   *  setter, so the pulse resets to idle — follow with setPulse/setDuty. */
  setPeriod(periodNs: number): void {
    pwmSetPeriod(this._pin, periodNs);
  }

  /** Square-wave sugar (the legacy tone()): one pwm_set_dt at 50% duty for
   *  `hz`. Takes over the channel's period — a later setPulse/setDuty at a
   *  call site that hasn't run yet re-applies the construction period once,
   *  so treat tone as owning a dedicated channel. Stop with setDuty(0). */
  tone(hz: number): void {
    pwmTone(this._pin, hz);
  }
}
