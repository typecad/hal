// ---------------------------------------------------------------------------
// Pin — the board-addressable pin identity (legacy GPIO classes removed)
//
// A Pin carries its canonical datasheet port name (Pin.fromPort("PB5")) and/or
// framework pin number; the transpiler resolves it via the MCU package's pin
// mapping. It is an ADDRESS, not a configured peripheral — configure pins by
// constructing the thin peripherals with them:
//
//   new GPIO(PB5, GPIO.OUTPUT | GPIO.PULL_UP)
//   new PWM(PA5, { periodNs: 20_000_000 })
//   new ADC(A1)
//
// The former OutputPin/InputPin/ToneChain classes (and their as*/read/write/
// pwm methods) were removed with the legacy Arduino surface. Their thin
// replacements are gpio-pin.ts / pwm-pin.ts / adc-pin.ts.
// ---------------------------------------------------------------------------

/**
 * A board pin identity — an address, not a configured peripheral. Board
 * modules export one Pin constant per datasheet pin (e.g. `PA5`, `P0_28`,
 * `GP25`) plus silkscreen aliases (`LED`, `BUTTON`, `D0`…), all pointing
 * at the same pads. Pass them to the peripheral constructors to configure
 * the pin: `new GPIO(PA5, GPIO.OUTPUT)`, `new PWM(PA5, { periodNs:
 * 20_000_000 })`, `new ADC(A1)`.
 */
export class Pin {
  /** MCU port name (e.g. "PB5") — empty string for legacy numeric pins */
  private _port: string;
  /** Raw pin index (-1 for port-named pins). */
  private _pin: number;
  /** Public readonly access to port name */
  readonly port: string;
  readonly number: number;
  readonly gpio: number;

  /** Create a Pin from a raw pin index — prefer the board module's named
   *  pin constants, which map to the schematic. */
  constructor(pin: number) {
    this._port = '';
    this._pin = pin;
    this.port = '';
    this.number = pin;
    this.gpio = pin;
  }

  /** Create a Pin from its datasheet port name (e.g. "PB5", "PC0"). In
   *  user code prefer the board module's exported pin constants — they
   *  already carry the right names. */
  static fromPort(portName: string): Pin {
    const p = new Pin(-1);
    p._port = portName;
    // Bypass readonly for factory method
    (p as any).port = portName;
    return p;
  }
}
