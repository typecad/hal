// ---------------------------------------------------------------------------
// Servo — hobby RC servo output on a PWM channel
//
// A calibrated 50 Hz wrapper over the thin PWM class: the construction opts
// carry the servo's calibrated pulse range (`minUs`/`maxUs`, defaults
// 1000/2000) and optional travel (`maxAngle`, default 180). writeAngle maps
// the angle onto that range in the LOWERED C++ (the mapping is runtime
// arithmetic against a runtime angle — it cannot fold at transpile time),
// and every write clamps to the calibrated range so a stray value cannot
// command a damaging pulse width. idle() stops driving the pulse (the line
// goes low); Zephyr's PWM model has no channel release, and most servos
// stop actively holding position without pulses.
// ----------------------------------------------------------------------------

import { servoWriteUs, servoWriteAngle, servoIdle } from './emit.js';
import type { Pin } from './gpio.js';

/**
 * A hobby RC servo: `const s = new Servo(PA5); s.writeAngle(90);`. The
 * defaults fit most servos (1000–2000 µs over a 50 Hz period); calibrate
 * with `minUs`/`maxUs` when the endpoints matter, and set `maxAngle` for
 * wider-travel servos (e.g. 270).
 */
export class Servo {
  private readonly _pin: number;
  private readonly _minUs: number;
  private readonly _maxUs: number;
  private readonly _maxAngle: number;
  private readonly _periodNs: number;
  // Routing overrides (the inline escape hatch): the DT controller nodelabel
  // and channel for pins the facts layer does not cover.
  private readonly _controller: string;
  private readonly _channel: number;

  /** Construct a servo channel. `minUs`/`maxUs` are the calibrated endpoint
   *  pulse widths (default 1000/2000), `maxAngle` the travel writeAngle()
   *  addresses (default 180), `periodNs` the channel period (default
   *  20_000_000 = 50 Hz). `controller`/`channel` are manual routing overrides
   *  for pins the board data doesn't cover. */
  constructor(
    pin: number | Pin,
    opts: {
      minUs?: number;
      maxUs?: number;
      maxAngle?: number;
      periodNs?: number;
      controller?: string;
      channel?: number;
    } = {},
  ) {
    this._pin = typeof pin === 'number' ? pin : pin.number;
    this._minUs = opts.minUs ?? 1000;
    this._maxUs = opts.maxUs ?? 2000;
    this._maxAngle = opts.maxAngle ?? 180;
    this._periodNs = opts.periodNs ?? 20_000_000;
    this._controller = opts?.controller ?? '';
    this._channel = opts?.channel ?? -1;
  }

  /** Command a pulse width in microseconds, clamped to the calibrated
   *  [minUs, maxUs] range. */
  writeUs(us: number): void {
    servoWriteUs(this._pin, this._periodNs, this._minUs, this._maxUs, us, this._controller, this._channel);
  }

  /** Command an angle in degrees (0 to maxAngle, clamped), mapped onto the
   *  calibrated pulse range. */
  writeAngle(angle: number): void {
    servoWriteAngle(this._pin, this._periodNs, this._minUs, this._maxUs, this._maxAngle, angle, this._controller, this._channel);
  }

  /** Stop driving the pulse — the line goes idle (low) and the servo stops
   *  actively holding position. Zephyr's PWM model has no channel release;
   *  re-drive with writeUs/writeAngle. */
  idle(): void {
    servoIdle(this._pin, this._periodNs, this._controller, this._channel);
  }
}
