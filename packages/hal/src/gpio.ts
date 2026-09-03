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

export class Pin {
  /** MCU port name (e.g. "PB5") — empty string for legacy numeric pins */
  private _port: string;
  /** Framework pin number (e.g. 13 for Arduino). -1 for port-based pins. */
  private _pin: number;
  /** Public readonly access to port name */
  readonly port: string;
  readonly number: number;
  readonly gpio: number;

  /** Legacy constructor — creates a Pin from a framework pin number */
  constructor(pin: number) {
    this._port = '';
    this._pin = pin;
    this.port = '';
    this.number = pin;
    this.gpio = pin;
  }

  /**
   * Create a Pin from its MCU datasheet port name (e.g. "PB5", "PC0").
   * The port name is the canonical identity; framework-specific pin numbers
   * are resolved at transpile time via the MCU package's pin mapping.
   */
  static fromPort(portName: string): Pin {
    const p = new Pin(-1);
    p._port = portName;
    // Bypass readonly for factory method
    (p as any).port = portName;
    return p;
  }
}
