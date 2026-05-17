import { gpioWrite, gpioRead, gpioToggle, gpioSetMode, tonePlay, toneStop, adcRead, adcReadVoltage, adcSetReference, interruptAttach, interruptDetach, pwmWrite, rawCpp } from './emit';
import { board } from './board';
import { callback } from './callback';
import { ADC } from './adc';
import { HIGH } from './constants';

export class OutputPin {
  private _pin: number;
  private _lastFreq: number;
  readonly number: number;
  readonly gpio: number;

  constructor(pin: number) {
    this._pin = pin;
    this.number = pin;
    this.gpio = pin;
    this._lastFreq = 0;
  }

  high(): void {
    gpioWrite(this._pin, 1);
  }

  low(): void {
    gpioWrite(this._pin, 0);
  }

  toggle(): void {
    gpioToggle(this._pin);
  }

  write(value: number | boolean): void {
    gpioWrite(this._pin, value);
  }

  pulse(durationMs: number): void {
    gpioWrite(this._pin, 1);
    rawCpp(`delayMicroseconds(${durationMs} * 1000);`);
    gpioWrite(this._pin, 0);
  }

  tone(frequency: number): ToneChain {
    this._lastFreq = frequency;
    tonePlay(this._pin, frequency);
    return new ToneChain(this._pin, this._lastFreq);
  }

  toneFor(frequency: number, duration: number): void {
    tonePlay(this._pin, frequency, duration);
  }

  noTone(): void {
    toneStop(this._pin);
  }

  pwm(percent: number): void {
    rawCpp(`analogWrite(${this._pin}, ${percent} * ((1 << ${board("peripherals.pwm.resolution")}) - 1) / 100);`);
  }

  getPwmFrequency(): number {
    return Number(board("peripherals.pwm.maxFrequency"));
  }

  getPwmResolution(): number {
    return Number(board("peripherals.pwm.resolution"));
  }
}

export class InputPin {
  private _pin: number;
  readonly number: number;
  readonly gpio: number;

  constructor(pin: number) {
    this._pin = pin;
    this.number = pin;
    this.gpio = pin;
  }

  read(): boolean {
    return gpioRead(this._pin) as unknown as boolean;
  }

  isHigh(): boolean {
    return this.read();
  }

  isLow(): boolean {
    return !this.read();
  }

  readAnalog(): number {
    return adcRead(this._pin);
  }

  readVoltage(): number {
    return adcReadVoltage(this._pin);
  }

  getAnalogResolution(): number {
    return Number(board("peripherals.adc.0.resolution"));
  }

  setAnalogReference(ref: number | string): void {
    ADC._reference = String(ref);
    adcSetReference(ref);
  }

  onFalling(handler: () => void): void {
    interruptAttach(this._pin, callback(handler), "FALLING");
  }

  onRising(handler: () => void): void {
    interruptAttach(this._pin, callback(handler), "RISING");
  }

  onChange(handler: () => void): void {
    interruptAttach(this._pin, callback(handler), "CHANGE");
  }

  offAll(): void {
    interruptDetach(this._pin);
  }

  /**
   * Wait for a RISING edge on this input pin.
   * Returns a Promise<void> that resolves when the pin transitions from LOW to HIGH.
   * The platform strategy controls whether this uses interrupts, polling, or a stub.
   *
   * @param timeout Optional timeout in milliseconds. If provided, the promise
   *   rejects (or resolves with a false/error) after the timeout expires.
   */
  waitForRising(timeout?: number): Promise<void> {
    rawCpp(`__typehal_wait_pin_edge(${this._pin}, RISING, ${timeout ?? -1})`);
    return undefined as any;
  }

  /**
   * Wait for a FALLING edge on this input pin.
   * Returns a Promise<void> that resolves when the pin transitions from HIGH to LOW.
   *
   * @param timeout Optional timeout in milliseconds. If provided, the promise
   *   rejects (or resolves with a false/error) after the timeout expires.
   */
  waitForFalling(timeout?: number): Promise<void> {
    rawCpp(`__typehal_wait_pin_edge(${this._pin}, FALLING, ${timeout ?? -1})`);
    return undefined as any;
  }
}

export class ToneChain {
  private _pin: number;
  private _lastFreq: number;

  constructor(pin: number, frequency: number) {
    this._pin = pin;
    this._lastFreq = frequency;
  }

  for(duration: number): void {
    tonePlay(this._pin, this._lastFreq, duration);
  }
}

/**
 * Represents a physical hardware pin before it has been configured for a specific mode.
 * Use `.asInput()` or `.asOutput()` to obtain a functional pin instance.
 *
 * Pins can be created two ways:
 * - `new Pin(number)` — legacy, using framework pin number (e.g. Arduino pin 13)
 * - `Pin.fromPort("PB5")` — preferred, using MCU datasheet port name
 *
 * When created via `fromPort()`, the pin carries its canonical port identity.
 * The transpiler resolves the port name to a framework pin number at compile time
 * using the MCU package's pin mapping (e.g. arduino-map.ts).
 */
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

  asOutput(initial?: number | boolean): OutputPin {
    gpioSetMode(this._pin, "OUTPUT");
    if (initial !== undefined) {
      gpioWrite(this._pin, initial);
    }
    return this as any;
  }

  output(initial?: number | boolean): OutputPin {
    gpioSetMode(this._pin, "OUTPUT");
    if (initial !== undefined) {
      gpioWrite(this._pin, initial);
    }
    return this as any;
  }

  asInput(): InputPin {
    gpioSetMode(this._pin, "INPUT");
    return this as any;
  }

  asInputPullUp(): InputPin {
    gpioSetMode(this._pin, "INPUT_PULLUP");
    return this as any;
  }

  asInputPullDown(): InputPin {
    gpioSetMode(this._pin, "INPUT_PULLDOWN");
    return this as any;
  }

  inputPullUp(): InputPin {
    gpioSetMode(this._pin, "INPUT_PULLUP");
    return this as any;
  }

  read(): boolean {
    return gpioRead(this._pin) as unknown as boolean;
  }

  write(value: number | boolean): void {
    gpioWrite(this._pin, value);
  }

  high(): void {
    gpioWrite(this._pin, 1);
  }

  low(): void {
    gpioWrite(this._pin, 0);
  }

  toggle(): void {
    gpioToggle(this._pin);
  }

  pwm(value: number): void {
    pwmWrite(this._pin, value);
  }

  tone(frequency: number): ToneChain {
    tonePlay(this._pin, frequency);
    return new ToneChain(this._pin, frequency);
  }

  noTone(): void {
    toneStop(this._pin);
  }
}
