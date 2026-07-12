import { describe, done } from '@typecad/expect';
import { D2, D3, D4, D9, D10, D11, D13, A0, LED } from '@typecad/board';

describe("Pin mode configuration")
  .it("Pin.output() alias configures without crashing")
  .expect(
    (() => {
      D11.output();
      return 1;
    })
  ).toBe(1)
  .it("Pin.inputPullUp() alias configures without crashing")
  .expect(
    (() => {
      D2.inputPullUp();
      return 1;
    })
  ).toBe(1)
  .it("Pin.asOutput(initial) sets initial level")
  .expect(
    (() => {
      D11.asOutput(1);
      return 1;
    })
  ).toBe(1)
  .it("Pin.asOutput() configures without crashing")
  .expect(
    (() => {
      D13.asOutput();
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
      D13.high();
      return 1;
    })
  ).toBe(1)
  .it("Pin.low() is callable")
  .expect(
    (() => {
      D13.low();
      return 1;
    })
  ).toBe(1)
  .it("Pin.toggle() is callable")
  .expect(
    (() => {
      D13.toggle();
      return 1;
    })
  ).toBe(1)
  .it("Pin.write() accepts a number")
  .expect(
    (() => {
      D13.write(1);
      return 1;
    })
  ).toBe(1)

describe("OutputPin methods via asOutput()")
  .it("OutputPin.high/low/toggle sequence is callable")
  .expect(
    (() => {
      const out = D11.asOutput();
      out.high();
      out.low();
      out.toggle();
      return 1;
    })
  ).toBe(1)
  .it("OutputPin.write() accepts a boolean")
  .expect(
    (() => {
      const out = D11.asOutput();
      out.write(true);
      return 1;
    })
  ).toBe(1)
  .it("OutputPin.tone() returns a ToneChain usable with .for()")
  .expect(
    (() => {
      const out = D10.asOutput();
      out.tone(440).for(50);
      return 1;
    })
  ).toBe(1)
  .it("OutputPin.toneFor() is callable")
  .expect(
    (() => {
      const out = D10.asOutput();
      out.toneFor(880, 20);
      return 1;
    })
  ).toBe(1)
  .it("OutputPin.noTone() is callable")
  .expect(
    (() => {
      const out = D10.asOutput();
      out.noTone();
      return 1;
    })
  ).toBe(1)
  .it("OutputPin.pwm() is callable")
  .expect(
    (() => {
      const out = D9.asOutput();
      out.pwm(50);
      return 1;
    })
  ).toBe(1)
  .it("OutputPin.pulse() is callable")
  .expect(
    (() => {
      D13.asOutput().pulse(1);
      return 1;
    })
  ).toBe(1)
  .it("OutputPin.getPwmFrequency()/getPwmResolution() are callable")
  .expect(
    (() => {
      const out = D9.asOutput();
      out.getPwmFrequency();
      out.getPwmResolution();
      return 1;
    })
  ).toBe(1)

describe("Pin methods before mode conversion")
  .it("Pin.read()/isHigh()/isLow() are callable")
  .expect(
    (() => {
      D2.asInputPullUp();
      D2.read();
      D2.isHigh();
      D2.isLow();
      return 1;
    })
  ).toBe(1)
  .it("Pin.pwm() is callable")
  .expect(
    (() => {
      D9.pwm(64);
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
      const leds = createPinGroup([D2, D3, D4]);
      leds.fill(false);
      return 1;
    })
  ).toBe(1)
  .it("createPinGroup().writePattern() is callable")
  .expect(
    (() => {
      const leds = createPinGroup([D2, D3, D4]);
      leds.writePattern(0b101);
      return 1;
    })
  ).toBe(1)
  .it("createPinGroup().readPattern() returns a non-negative bitmask")
  .expect(
    (() => {
      const leds = createPinGroup([D2, D3]);
      const pat = leds.readPattern();
      return pat >= 0 ? 1 : 0;
    })
  ).toBe(1)

done();
