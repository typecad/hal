// ---------------------------------------------------------------------------
// @typecode/board-esp32-devkit — Board-specific pin type overrides
//
// The ESP32 has two categories of GPIO pins:
//   1. Full GPIO pins — digital I/O + pull-up + pull-down + PWM + interrupt
//   2. Input-only pins (D34, D35, D36, D39) — no output, no pull-up/pull-down
//
// ESP32 supports hardware pull-down (unlike AVR), so inputPullDown is NOT
// omitted from any type. All output-capable GPIOs support LEDC PWM and
// GPIO interrupts, so those methods are made non-optional (NonNullable).
// ---------------------------------------------------------------------------

import type { BasePin, IOutputModePin, IInputModePin } from '@typecode/core';

// ---------------------------------------------------------------------------
// Method groups — used to cleanly Omit methods from pin types
// ---------------------------------------------------------------------------

/** Methods only available on analog-capable pins. */
type AnalogMethods = 'readAnalog' | 'readVoltage' | 'setAnalogReference' | 'getAnalogResolution';

/** Methods only available on PWM-capable pins. */
type PWMMethods = 'pwm' | 'getPwmFrequency' | 'getPwmResolution';

/** Methods only available on interrupt-capable pins. */
type InterruptMethods = 'onRising' | 'onFalling' | 'onChange' | 'offInterrupts';

/** Output methods unavailable on input-only pins (D34, D35, D36, D39). */
type OutputMethods = 'write' | 'high' | 'low' | 'toggle' | 'pulse' | 'tone' | 'noTone'
  | 'asOutput' | 'outputOpenDrain';

/** Pull-up/pull-down unavailable on input-only pins (no internal resistors). */
type PullMethods = 'inputPullUp' | 'inputPullDown';

// ---------------------------------------------------------------------------
// Pin types
// ---------------------------------------------------------------------------

/**
 * Full GPIO pin — digital I/O + pull-up + pull-down + PWM + interrupt.
 * Used for all output-capable ESP32 GPIOs (D0-D5, D12-D19, D21-D23, D25-D27, D32-D33).
 */
export type IESP32FullGPIOPin = BasePin & {
  pwm: NonNullable<BasePin['pwm']>;
  getPwmFrequency: NonNullable<BasePin['getPwmFrequency']>;
  getPwmResolution: NonNullable<BasePin['getPwmResolution']>;
  onRising: NonNullable<BasePin['onRising']>;
  onFalling: NonNullable<BasePin['onFalling']>;
  onChange: NonNullable<BasePin['onChange']>;
  offInterrupts: NonNullable<BasePin['offInterrupts']>;
};

/**
 * Input-only pin (D34, D35, D36, D39) — no output, no pull-up/pull-down.
 * Supports digital read, ADC, and GPIO interrupts only.
 */
export type IESP32InputOnlyPin = Omit<BasePin, OutputMethods | PullMethods | PWMMethods> & {
  readAnalog: NonNullable<BasePin['readAnalog']>;
  readVoltage: NonNullable<BasePin['readVoltage']>;
  getAnalogResolution: NonNullable<BasePin['getAnalogResolution']>;
  onRising: NonNullable<BasePin['onRising']>;
  onFalling: NonNullable<BasePin['onFalling']>;
  onChange: NonNullable<BasePin['onChange']>;
  offInterrupts: NonNullable<BasePin['offInterrupts']>;
};

// ---------------------------------------------------------------------------
// Mode-restricted pin types
// ---------------------------------------------------------------------------

/** Output-mode pin on ESP32 — PWM is always available on output-capable GPIOs. */
export type IESP32OutputModePin = IOutputModePin & {
  pwm: NonNullable<BasePin['pwm']>;
  getPwmFrequency: NonNullable<BasePin['getPwmFrequency']>;
  getPwmResolution: NonNullable<BasePin['getPwmResolution']>;
};

/** Input-mode pin on ESP32 — pull-down is supported (unlike AVR). */
export type IESP32InputModePin = IInputModePin;
