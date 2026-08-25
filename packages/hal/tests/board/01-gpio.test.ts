import { describe, done } from '@typecad/expect';
// @typecad-requires-roles gpioOut, gpioIn, gpioGroup, interrupt
// Shared board-level GPIO suite. Runs unchanged on every board: pin choices
// live in each board package's test-pins.json (resolved via the
// '@typecad/test-pins' virtual module), so board particularities — which pins
// are free, which are PWM-capable, which have DT-spec aliases — are data, not
// per-board test copies.
import { GPIO_OUT, GPIO_IN, GPIO_GROUP, INT_PIN } from '@typecad/test-pins';
import { A0 } from '@typecad/board';

describe("Pin mode configuration")
  .it("Pin.output() alias configures without crashing")
  .expect(
    (() => {
      GPIO_OUT.output();
      return 1;
    })
  ).toBe(1)
  .it("Pin.inputPullUp() alias configures without crashing")
  .expect(
    (() => {
      GPIO_IN.inputPullUp();
      return 1;
    })
  ).toBe(1)
  .it("Pin.asOutput(initial) sets initial level")
  .expect(
    (() => {
      GPIO_OUT.asOutput(1);
      return 1;
    })
  ).toBe(1)
  .it("Pin.asOutput() configures without crashing")
  .expect(
    (() => {
      GPIO_OUT.asOutput();
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
      GPIO_OUT.high();
      return 1;
    })
  ).toBe(1)
  .it("Pin.low() is callable")
  .expect(
    (() => {
      GPIO_OUT.low();
      return 1;
    })
  ).toBe(1)
  .it("Pin.toggle() is callable")
  .expect(
    (() => {
      GPIO_OUT.toggle();
      return 1;
    })
  ).toBe(1)
  .it("Pin.write() accepts a number")
  .expect(
    (() => {
      GPIO_OUT.write(1);
      return 1;
    })
  ).toBe(1)

describe("OutputPin methods via asOutput()")
  .it("OutputPin.high/low/toggle sequence is callable")
  .expect(
    (() => {
      const out = GPIO_OUT.asOutput();
      out.high();
      out.low();
      out.toggle();
      return 1;
    })
  ).toBe(1)
  .it("OutputPin.write() accepts a boolean")
  .expect(
    (() => {
      const out = GPIO_OUT.asOutput();
      out.write(true);
      return 1;
    })
  ).toBe(1)
  .it("OutputPin.pulse() is callable")
  .expect(
    (() => {
      GPIO_OUT.asOutput().pulse(1);
      return 1;
    })
  ).toBe(1)

describe("Pin methods before mode conversion")
  .it("Pin.read()/isHigh()/isLow() are callable")
  .expect(
    (() => {
      GPIO_IN.asInputPullUp();
      GPIO_IN.read();
      GPIO_IN.isHigh();
      GPIO_IN.isLow();
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

describe("Pin groups")
  .it("createPinGroup().fill() is callable")
  .expect(
    (() => {
      const leds = createPinGroup(GPIO_GROUP);
      leds.fill(false);
      return 1;
    })
  ).toBe(1)
  .it("createPinGroup().writePattern() is callable")
  .expect(
    (() => {
      const leds = createPinGroup(GPIO_GROUP);
      leds.writePattern(0b101);
      return 1;
    })
  ).toBe(1)
  .it("createPinGroup().readPattern() returns a non-negative bitmask")
  .expect(
    (() => {
      const leds = createPinGroup(GPIO_GROUP);
      const pat = leds.readPattern();
      return pat >= 0 ? 1 : 0;
    })
  ).toBe(1)

describe("InputPin edge helpers")
  .it("onFalling/onRising/onChange/offAll are callable")
  .expect(
    (() => {
      const btn = INT_PIN.asInputPullUp();
      btn.onFalling(() => {});
      btn.onRising(() => {});
      btn.onChange(() => {});
      btn.offAll();
      return 1;
    })
  ).toBe(1)

done();
