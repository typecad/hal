// ---------------------------------------------------------------------------
// control.ts — pure control logic, no hardware imports.
//
// Exercises the transpiler's object model: enums, an interface with an
// implementing class, inheritance with a super() call and an overridden
// protected method (virtual dispatch through the base's update()), static
// factory + static counter, private/protected/readonly fields, a getter,
// array indexing, for/for-of loops, switch, and compound assignment.
// ---------------------------------------------------------------------------

export enum FanMode {
  Off = 0,
  Auto = 1,
  Boost = 2,
  Manual = 3,
}

export function nextMode(mode: FanMode): FanMode {
  switch (mode) {
    case FanMode.Off:
      return FanMode.Auto;
    case FanMode.Auto:
      return FanMode.Boost;
    case FanMode.Boost:
      return FanMode.Manual;
    default:
      return FanMode.Off;
  }
}

export function modeLabel(mode: FanMode): string {
  switch (mode) {
    case FanMode.Auto:
      return 'AUTO';
    case FanMode.Boost:
      return 'BOOST';
    case FanMode.Manual:
      return 'MAN';
    default:
      return 'OFF';
  }
}

/** Anything that can hand back the current filtered temperature. */
export interface TelemetrySource {
  celsius(): number;
}

/** Fixed-capacity ring buffer with running sum — O(1) mean. */
export class RingStats implements TelemetrySource {
  private readonly _buf: number[];
  private readonly _cap: number;
  private _head: number;
  private _fill: number;
  private _sum: number;

  constructor(cap: number) {
    this._cap = cap;
    this._buf = new Array<number>(cap);
    this._head = 0;
    this._fill = 0;
    this._sum = 0.0;
  }

  push(x: number): void {
    if (this._fill === this._cap) {
      // Full: retire the oldest sample from the sum before overwriting it.
      this._sum -= this._buf[this._head];
    } else {
      this._fill += 1;
    }
    this._buf[this._head] = x;
    this._sum += x;
    this._head = (this._head + 1) % this._cap;
  }

  celsius(): number {
    return this.mean();
  }

  mean(): number {
    return this._fill === 0 ? 0.0 : this._sum / this._fill;
  }

  /** max − min over the resident samples: how noisy the window is. */
  spread(): number {
    if (this._fill === 0) {
      return 0.0;
    }
    let lo = this._buf[0];
    let hi = this._buf[0];
    for (let i = 1; i < this._fill; i += 1) {
      const v = this._buf[i];
      if (v < lo) {
        lo = v;
      }
      if (v > hi) {
        hi = v;
      }
    }
    return hi - lo;
  }
}

/** Textbook PID with anti-windup clamping on the integral term. */
export class Pid {
  private readonly _kp: number;
  private readonly _ki: number;
  private readonly _kd: number;
  private readonly _windup: number;
  private _integral: number;
  private _prevError: number;
  private _primed: boolean;

  /** Every controller constructed since boot (diagnostics). */
  static constructed: number = 0;

  constructor(kp: number, ki: number, kd: number, windup = 3.0) {
    this._kp = kp;
    this._ki = ki;
    this._kd = kd;
    this._windup = windup;
    this._integral = 0.0;
    this._prevError = 0.0;
    this._primed = false;
    Pid.constructed += 1;
  }

  /** Tuned starting point for a small bench fan. */
  static bench(): Pid {
    return new Pid(0.09, 0.002, 0.4);
  }

  reset(): void {
    this._integral = 0.0;
    this._prevError = 0.0;
    this._primed = false;
  }

  /** One controller step; returns the correction to add around mid-scale. */
  step(setpointC: number, measuredC: number, dtSec: number): number {
    const error = setpointC - measuredC;
    if (!this._primed) {
      this._primed = true;
      this._prevError = error;
    }
    this._integral += error * dtSec;
    if (this._integral > this._windup) {
      this._integral = this._windup;
    }
    if (this._integral < -this._windup) {
      this._integral = -this._windup;
    }
    const derivative = (error - this._prevError) / dtSec;
    this._prevError = error;
    return this._kp * error + this._ki * this._integral + this._kd * derivative;
  }

  get integral(): number {
    return this._integral;
  }
}

/** Latches when a value crosses a limit; update() reports entries only. */
export class Threshold {
  protected readonly _limit: number;
  private _high: boolean;

  constructor(limit: number) {
    this._limit = limit;
    this._high = false;
  }

  protected evaluate(v: number): boolean {
    return v > this._limit;
  }

  /** Feed a sample; true exactly when the alarm is entered this call. */
  update(v: number): boolean {
    const nowHigh = this.evaluate(v);
    const entered = nowHigh && !this._high;
    this._high = nowHigh;
    return entered;
  }

  get high(): boolean {
    return this._high;
  }
}

/** A Threshold that also alarms below a floor (band alarm). */
export class BandThreshold extends Threshold {
  private readonly _floor: number;

  constructor(floor: number, ceiling: number) {
    super(ceiling);
    this._floor = floor;
  }

  protected override evaluate(v: number): boolean {
    return v > this._limit || v < this._floor;
  }
}
