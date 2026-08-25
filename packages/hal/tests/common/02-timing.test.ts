import { describe, done } from '@typecad/expect';

describe("Timing namespace")
  .it("Timing.millis() returns a non-negative value")
  .expect(
    (() => {
      const t = Timing.millis();
      return t >= 0 ? 1 : 0;
    })
  ).toBe(1)
  .it("Timing.micros() returns a non-negative value")
  .expect(
    (() => {
      const t = Timing.micros();
      return t >= 0 ? 1 : 0;
    })
  ).toBe(1)
  .it("Timing.millis() does not decrease")
  .expect(
    (() => {
      const a = Timing.millis();
      const b = Timing.millis();
      return b >= a ? 1 : 0;
    })
  ).toBe(1)
  .it("Timing.delay() is callable without crashing")
  .expect(
    (() => {
      Timing.delay(1);
      return 1;
    })
  ).toBe(1)
  .it("Timing.delayMicroseconds() is callable without crashing")
  .expect(
    (() => {
      Timing.delayMicroseconds(100);
      return 1;
    })
  ).toBe(1)

describe("Free timing functions")
  .it("delay() is callable without crashing")
  .expect(
    (() => {
      delay(1);
      return 1;
    })
  ).toBe(1)
  .it("delayMicroseconds() is callable without crashing")
  .expect(
    (() => {
      delayMicroseconds(50);
      return 1;
    })
  ).toBe(1)
  .it("millis() returns a non-negative value")
  .expect(
    (() => {
      const t = millis();
      return t >= 0 ? 1 : 0;
    })
  ).toBe(1)
  .it("micros() returns a non-negative value")
  .expect(
    (() => {
      const t = micros();
      return t >= 0 ? 1 : 0;
    })
  ).toBe(1)

describe("map() and constrain()")
  .it("map() scales the midpoint of a range")
  .expect(
    (() => {
      return map(512, 0, 1023, 0, 255);
    })
  ).toBe(127)
  .it("map() maps the low endpoint")
  .expect(
    (() => {
      return map(0, 0, 1023, 0, 255);
    })
  ).toBe(0)
  .it("map() maps the high endpoint")
  .expect(
    (() => {
      return map(1023, 0, 1023, 0, 255);
    })
  ).toBe(255)
  .it("constrain() clamps above the range")
  .expect(
    (() => {
      return constrain(200, 0, 100);
    })
  ).toBe(100)
  .it("constrain() clamps below the range")
  .expect(
    (() => {
      return constrain(-5, 0, 100);
    })
  ).toBe(0)
  .it("constrain() passes through an in-range value")
  .expect(
    (() => {
      return constrain(50, 0, 100);
    })
  ).toBe(50)

// NOTE: setInterval/setTimeout (free and Timing.*) are omitted — inside expect()
// IIFEs the transpiler does not rewrite them to __tc_setInterval/__tc_setTimeout,
// and empty arrow callbacks are not lowered to valid C++ function pointers.

done();
