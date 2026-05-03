import { emit } from './emit';
import { HIGH, LOW, OUTPUT, INPUT, INPUT_PULLUP } from './constants';

export class Pin {
  private _pin: number;

  /** Public pin number (read-only) for simulator and metadata access. */
  readonly number: number;

  constructor(pin: number) {
    this._pin = pin;
    this.number = pin;
  }

  asOutput(value: number = LOW): Pin {
    emit(`pinMode(${this._pin}, OUTPUT);`);
    emit(`digitalWrite(${this._pin}, ${value});`);
    return this;
  }

  asInput(): Pin {
    emit(`pinMode(${this._pin}, INPUT);`);
    return this;
  }

  asInputPullUp(): Pin {
    emit(`pinMode(${this._pin}, INPUT_PULLUP);`);
    return this;
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

  write(value: number): void {
    emit(`digitalWrite(${this._pin}, ${value});`);
  }

  read(): number {
    return digitalRead(this._pin);
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

  pwm(value: number): void {
    emit(`analogWrite(${this._pin}, ${value});`);
  }

  onFalling(handler: () => void): void {
    emit(`attachInterrupt(digitalPinToInterrupt(${this._pin}), handler, FALLING);`);
  }

  onRising(handler: () => void): void {
    emit(`attachInterrupt(digitalPinToInterrupt(${this._pin}), handler, RISING);`);
  }

  onChange(handler: () => void): void {
    emit(`attachInterrupt(digitalPinToInterrupt(${this._pin}), handler, CHANGE);`);
  }

  offAll(): void {
    emit(`detachInterrupt(digitalPinToInterrupt(${this._pin}));`);
  }
}

declare function digitalRead(pin: number): number;
declare function delayMicroseconds(us: number): void;
declare function tone(pin: number, frequency: number, duration?: number): void;
declare function noTone(pin: number): void;
declare function analogWrite(pin: number, value: number): void;
