import { emit } from './emit';
import { board } from './board';
import { callback } from './callback';
import { ADC } from './adc';
import { HIGH, LOW, OUTPUT, INPUT, INPUT_PULLUP } from './constants';

export class OutputPin {
  private _pin: number;
  readonly number: number;
  readonly gpio: number;

  constructor(pin: number) {
    this._pin = pin;
    this.number = pin;
    this.gpio = pin;
  }

  high(): void {
    emit(`digitalWrite(${this._pin}, HIGH);`);
  }

  low(): void {
    emit(`digitalWrite(${this._pin}, LOW);`);
  }

  toggle(): void {
    emit(`digitalWrite(${this._pin}, digitalRead(${this._pin}) == LOW ? HIGH : LOW);`);
  }

  write(value: number | boolean): void {
    emit(`digitalWrite(${this._pin}, ${value});`);
  }

  pulse(duration: number): void {
    emit(`digitalWrite(${this._pin}, HIGH);`);
    emit(`delayMicroseconds(${duration});`);
    emit(`digitalWrite(${this._pin}, LOW);`);
  }

  tone(frequency: number): void {
    emit(`tone(${this._pin}, ${frequency});`);
  }

  toneFor(frequency: number, duration: number): void {
    emit(`tone(${this._pin}, ${frequency}, ${duration});`);
  }

  noTone(): void {
    emit(`noTone(${this._pin});`);
  }

  pwm(percent: number): void {
    emit(`analogWrite(${this._pin}, ${percent} * ((1 << ${board("peripherals.pwm.resolution")}) - 1) / 100);`);
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

  read(): number {
    return digitalRead(this._pin);
  }

  readAnalog(): number {
    emit(`return analogRead(${this._pin});`);
    return 0;
  }

  readVoltage(): number {
    emit(`return analogRead(${this._pin}) * ${board("peripherals.adc.0.referenceVoltages." + ADC._reference)} / ${board("peripherals.adc.0.maxValue")};`);
    return 0;
  }

  onFalling(handler: () => void): void {
    emit(`attachInterrupt(digitalPinToInterrupt(${this._pin}), ${callback(handler)}, FALLING);`);
  }

  onRising(handler: () => void): void {
    emit(`attachInterrupt(digitalPinToInterrupt(${this._pin}), ${callback(handler)}, RISING);`);
  }

  onChange(handler: () => void): void {
    emit(`attachInterrupt(digitalPinToInterrupt(${this._pin}), ${callback(handler)}, CHANGE);`);
  }

  offAll(): void {
    emit(`detachInterrupt(digitalPinToInterrupt(${this._pin}));`);
  }

  waitForRising(timeout?: number): Promise<void> {
    emit(`__EDGE_RISING__${this._pin}__T${timeout}`);
    return undefined as any;
  }

  waitForFalling(timeout?: number): Promise<void> {
    emit(`__EDGE_FALLING__${this._pin}__T${timeout}`);
    return undefined as any;
  }
}

export class Pin {
  private _pin: number;
  readonly number: number;
  readonly gpio: number;

  constructor(pin: number) {
    this._pin = pin;
    this.number = pin;
    this.gpio = pin;
  }

  asOutput(): OutputPin {
    emit(`pinMode(${this._pin}, OUTPUT);`);
    return this as any;
  }

  output(): OutputPin {
    emit(`pinMode(${this._pin}, OUTPUT);`);
    return this as any;
  }

  asInput(): InputPin {
    emit(`pinMode(${this._pin}, INPUT);`);
    return this as any;
  }

  asInputPullUp(): InputPin {
    emit(`pinMode(${this._pin}, INPUT_PULLUP);`);
    return this as any;
  }

  inputPullUp(): InputPin {
    emit(`pinMode(${this._pin}, INPUT_PULLUP);`);
    return this as any;
  }
}

declare function digitalRead(pin: number): number;
declare function delayMicroseconds(us: number): void;
declare function tone(pin: number, frequency: number, duration?: number): void;
declare function noTone(pin: number): void;
declare function analogWrite(pin: number, value: number): void;
