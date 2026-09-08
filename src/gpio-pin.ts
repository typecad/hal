// ---------------------------------------------------------------------------
// GPIO — the thin Zephyr-shaped digital pin class
//
// One configured pin handle ≈ gpio_dt_spec + flags, mirroring Zephyr's verbs:
// construction carries the flag combination (GPIO.OUTPUT | GPIO.PULL_UP),
// set/get/toggle lower to gpio_pin_set_dt / get_dt / toggle_dt (logical
// levels — polarity comes from the board's DT node when the pin has a dtSpec),
// and the configure itself is emitted guarded-per-pin ahead of the first use,
// so construction flags apply exactly once. No mode strings, no shadow reads.
//
// Flag and interrupt tokens are Zephyr's names under the GPIO. namespace
// (GPIO_OUTPUT ↔ GPIO.OUTPUT, GPIO_INT_EDGE_FALLING ↔ GPIO.INT_EDGE_FALLING);
// the lowering maps token NAMES to macros, so any Zephyr doc greps both ways.
// ----------------------------------------------------------------------------

import { gpioWrite, gpioReadCfg, gpioToggle, gpioConfigure, interruptAttachFlags, interruptDetach } from './emit.js';
import { callback } from './callback.js';
import type { Pin } from './gpio.js';

export class GPIO {
  // ── Config flags (gpio.h) ──────────────────────────────────────────────
  static readonly INPUT = 0x001;
  static readonly OUTPUT = 0x002;
  /** Configure the output buffer's initial level atomically — no
   *  configure-then-write glitch window. */
  static readonly OUTPUT_INIT_LOW = 0x004;
  static readonly OUTPUT_INIT_HIGH = 0x008;
  static readonly PULL_UP = 0x010;
  static readonly PULL_DOWN = 0x020;
  static readonly OPEN_DRAIN = 0x040;
  static readonly OPEN_SOURCE = 0x080;
  static readonly DISCONNECTED = 0x100;

  // ── Interrupt flags (GPIO_INT_* minus the prefix) ──────────────────────
  static readonly INT_DISABLE = 0x01;
  static readonly INT_EDGE_RISING = 0x02;
  static readonly INT_EDGE_FALLING = 0x04;
  static readonly INT_EDGE_BOTH = 0x08;
  static readonly INT_LEVEL_LOW = 0x10;
  static readonly INT_LEVEL_HIGH = 0x20;

  private readonly _pin: number;
  private readonly _flags: number;

  /** Construct a configured pin. `flags` is a combination of the GPIO.*
   *  statics (the transpiler carries the token text; the values are for the
   *  editor only). The configure applies once, ahead of the first
   *  set/get/toggle/onInterrupt call. */
  constructor(pin: number | Pin, flags: number) {
    this._pin = typeof pin === 'number' ? pin : pin.number;
    this._flags = flags;
  }

  /** Drive the pin (gpio_pin_set_dt / set_raw). Logical level: on a pin with
   *  a board dtSpec (LED, BUTTON), true means "active" — the DT node's
   *  GPIO_ACTIVE_LOW is honored. */
  set(value: boolean): void {
    gpioConfigure(this._pin, this._flags);
    gpioWrite(this._pin, value);
  }

  /** Read the pin (gpio_pin_get_dt / get_raw). Logical level. The guarded
   *  configure is FUSED into the read's lowering (one statement-expression),
   *  so the pin is correctly configured even when the call sits in a pure
   *  expression position (if-conditions, comparisons) where a method's
   *  leading side-effect ops would otherwise be dropped. */
  get(): boolean {
    return gpioReadCfg(this._pin, this._flags) as unknown as boolean;
  }

  /** Toggle the pin (gpio_pin_toggle_dt — the driver's atomic toggle). */
  toggle(): void {
    gpioConfigure(this._pin, this._flags);
    gpioToggle(this._pin);
  }

  /** Attach an interrupt (gpio_pin_interrupt_configure_dt +
   *  gpio_init_callback + gpio_add_callback). `intFlags` is one GPIO.INT_*
   *  token — Zephyr's names verbatim, covering the level modes the legacy
   *  onHigh/onLow strings could not express. */
  onInterrupt(intFlags: number, handler: () => void): void {
    gpioConfigure(this._pin, this._flags);
    interruptAttachFlags(this._pin, callback(handler), intFlags);
  }

  /** Detach the interrupt (disable + remove callback). */
  offInterrupt(): void {
    interruptDetach(this._pin);
  }
}

