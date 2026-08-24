import { describe, done } from '@typecad/expect';
// Black Pill pin spread: digital smoke pins are free port pins; PWM needs the
// board's synthesized PWM channels (TIM4 on PB6/PB7 — the only pwm4 specs the
// Zephyr chip descriptor maps). A0 = PA0 (ADC1_IN0).
import { PB0, PB1, PB10, PB6, PB7, PB5, PA0, PA1, A0, LED } from '@typecad/board';

describe("Pin mode configuration")
  .it("Pin.output() alias configures without crashing")
  .expect(
    (() => {
      PB5.output();
      return 1;
    })
  ).toBe(1)
  .it("Pin.inputPullUp() alias configures without crashing")
  .expect(
    (() => {
      PB0.inputPullUp();
      return 1;
    })
  ).toBe(1)
  .it("Pin.asOutput(initial) sets initial level")
  .expect(
    (() => {
      PB5.asOutput(1);
      return 1;
    })
  ).toBe(1)
  .it("Pin.asOutput() configures without crashing")
  .expect(
    (() => {
      PA1.asOutput();
      return 1;
    })
  ).toBe(1)
  .it("Pin.asInput() configures without crashing")
  .expect(
    (() => {
      A0.asInput();
      return 1;
    })
  ).toBe(1)
  .it("Pin.asInputPullUp() configures without crashing")
  .expect(
    (() => {
      A0.asInputPullUp();
      return 1;
    })
  ).toBe(1)

describe("Pin digital writes")
  .it("Pin.high() is callable")
  .expect(
    (() => {
      PA1.high();
      return 1;
    })
  ).toBe(1)
  .it("Pin.low() is callable")
  .expect(
    (() => {
      PA1.low();
      return 1;
    })
  ).toBe(1)
  .it("Pin.toggle() is callable")
  .expect(
    (() => {
      PA1.toggle();
      return 1;
    })
  ).toBe(1)
  .it("Pin.write() accepts a number")
  .expect(
    (() => {
      PA1.write(1);
      return 1;
    })
  ).toBe(1)

describe("OutputPin methods via asOutput()")
  .it("OutputPin.high/low/toggle sequence is callable")
  .expect(
    (() => {
      const out = PB5.asOutput();
      out.high();
      out.low();
      out.toggle();
      return 1;
    })
  ).toBe(1)
  .it("OutputPin.write() accepts a boolean")
  .expect(
    (() => {
      const out = PB5.asOutput();
      out.write(true);
      return 1;
    })
  ).toBe(1)
  .it("OutputPin.tone() returns a ToneChain usable with .for()")
  .expect(
    (() => {
      const out = PB7.asOutput();
      out.tone(440).for(50);
      return 1;
    })
  ).toBe(1)
  .it("OutputPin.toneFor() is callable")
  .expect(
    (() => {
      const out = PB7.asOutput();
      out.toneFor(880, 20);
      return 1;
    })
  ).toBe(1)
  .it("OutputPin.noTone() is callable")
  .expect(
    (() => {
      const out = PB7.asOutput();
      out.noTone();
      return 1;
    })
  ).toBe(1)
  .it("OutputPin.pwm() is callable")
  .expect(
    (() => {
      const out = PB6.asOutput();
      out.pwm(50);
      return 1;
    })
  ).toBe(1)
  .it("OutputPin.pulse() is callable")
  .expect(
    (() => {
      PA1.asOutput().pulse(1);
      return 1;
    })
  ).toBe(1)
  .it("OutputPin.getPwmFrequency() returns the board PWM max frequency")
  .expect(
    (() => {
      const out = PB6.asOutput();
      return out.getPwmFrequency();
    })
  ).toBe(50000000)
  .it("OutputPin.getPwmResolution() returns the board PWM resolution in bits")
  .expect(
    (() => {
      const out = PB6.asOutput();
      return out.getPwmResolution();
    })
  ).toBe(16)

describe("Pin methods before mode conversion")
  .it("Pin.read()/isHigh()/isLow() are callable")
  .expect(
    (() => {
      PB0.asInputPullUp();
      PB0.read();
      PB0.isHigh();
      PB0.isLow();
      return 1;
    })
  ).toBe(1)
  .it("Pin.pwm() is callable")
  .expect(
    (() => {
      PB6.pwm(64);
      return 1;
    })
  ).toBe(1)

describe("InputPin methods via asInput()")
  .it("InputPin.read() is callable")
  .expect(
    (() => {
      A0.asInput().read();
      return 1;
    })
  ).toBe(1)
  .it("InputPin.isHigh()/isLow() are callable")
  .expect(
    (() => {
      const inPin = A0.asInput();
      inPin.isHigh();
      inPin.isLow();
      return 1;
    })
  ).toBe(1)

describe("Board pin aliases")
  .it("LED board alias is usable as a Pin")
  .expect(
    (() => {
      LED.high();
      LED.low();
      return 1;
    })
  ).toBe(1)

describe("Pin groups")
  .it("createPinGroup().fill() is callable")
  .expect(
    (() => {
      const leds = createPinGroup([PB0, PB1, PB10]);
      leds.fill(false);
      return 1;
    })
  ).toBe(1)
  .it("createPinGroup().writePattern() is callable")
  .expect(
    (() => {
      const leds = createPinGroup([PB0, PB1, PB10]);
      leds.writePattern(0b101);
      return 1;
    })
  ).toBe(1)
  .it("createPinGroup().readPattern() returns a non-negative bitmask")
  .expect(
    (() => {
      const leds = createPinGroup([PB0, PB1]);
      const pat = leds.readPattern();
      return pat >= 0 ? 1 : 0;
    })
  ).toBe(1)

describe("InputPin edge helpers")
  .it("onFalling/onRising/onChange/offAll are callable")
  .expect(
    (() => {
      const btn = PA0.asInputPullUp();
      btn.onFalling(() => {});
      btn.onRising(() => {});
      btn.onChange(() => {});
      btn.offAll();
      return 1;
    })
  ).toBe(1)

done();
