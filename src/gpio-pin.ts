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

/**
 * A configured digital pin: `new GPIO(LED, GPIO.OUTPUT)`. The second
 * argument combines the `GPIO.*` flags. `set`/`get`/`toggle` work in
 * logical levels — for pins the board marks active-low (common for LEDs
 * and buttons), `true` means "active", not "high voltage". Interrupts
 * attach with `onInterrupt(GPIO.INT_EDGE_FALLING, handler)`.
 */
export class GPIO {
  // ── Config flags (gpio.h) ──────────────────────────────────────────────
  static readonly INPUT = 0x001;
  static readonly OUTPUT = 0x002;
  /** Configure the output's initial level atomically — avoids a
   *  configure-then-write glitch window at startup. */
  static readonly OUTPUT_INIT_LOW = 0x004;
  static readonly OUTPUT_INIT_HIGH = 0x008;
  static readonly PULL_UP = 0x010;
  static readonly PULL_DOWN = 0x020;
  static readonly OPEN_DRAIN = 0x040;
  static readonly OPEN_SOURCE = 0x080;
  static readonly DISCONNECTED = 0x100;

  // ── Interrupt trigger modes (edge or level) ────────────────────────────
  static readonly INT_DISABLE = 0x01;
  static readonly INT_EDGE_RISING = 0x02;
  static readonly INT_EDGE_FALLING = 0x04;
  static readonly INT_EDGE_BOTH = 0x08;
  static readonly INT_LEVEL_LOW = 0x10;
  static readonly INT_LEVEL_HIGH = 0x20;

  private readonly _pin: number;
  private readonly _flags: number;

  /** Construct a configured pin. `flags` combines the GPIO.* statics, e.g.
   *  `GPIO.OUTPUT | GPIO.PULL_UP` or `GPIO.INPUT | GPIO.PULL_DOWN`. */
  constructor(pin: number | Pin, flags: number) {
    this._pin = typeof pin === 'number' ? pin : pin.number;
    this._flags = flags;
  }

  /** Drive the pin: `true` = active, `false` = inactive. On pins the board
   *  marks active-low (many LEDs, buttons), active is low voltage — the
   *  polarity is handled for you. */
  set(value: boolean): void {
    gpioConfigure(this._pin, this._flags);
    gpioWrite(this._pin, value);
  }

  /** Read the pin's logical level: `true` = active. Usable directly in
   *  if-conditions and comparisons like any boolean. */
  get(): boolean {
    return gpioReadCfg(this._pin, this._flags) as unknown as boolean;
  }

  /** Flip the pin to the opposite level, atomically. */
  toggle(): void {
    gpioConfigure(this._pin, this._flags);
    gpioToggle(this._pin);
  }

  /** Attach an interrupt handler. `intFlags` is one of the `GPIO.INT_*`
   *  trigger modes (edge or level). Keep the handler short — no blocking
   *  calls (no sleep, no I/O waits) inside it. */
  onInterrupt(intFlags: number, handler: () => void): void {
    gpioConfigure(this._pin, this._flags);
    interruptAttachFlags(this._pin, callback(handler), intFlags);
  }

  /** Detach the interrupt handler. */
  offInterrupt(): void {
    interruptDetach(this._pin);
  }
}

