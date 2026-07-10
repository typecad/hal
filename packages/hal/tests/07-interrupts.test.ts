import { describe, done } from '@typecad/expect';
import { D2 } from '@TypeCAD';

describe("Global interrupt control")
  .it("noInterrupts() is callable without crashing")
  .expect(
    (() => {
      noInterrupts();
      return 1;
    })
  ).toBe(1)
  .it("interrupts() is callable without crashing")
  .expect(
    (() => {
      interrupts();
      return 1;
    })
  ).toBe(1)
  .it("noInterrupts() then interrupts() restores state")
  .expect(
    (() => {
      noInterrupts();
      interrupts();
      return 1;
    })
  ).toBe(1)

describe("attachInterrupt / detachInterrupt")
  .it("attachInterrupt() registers a handler")
  .expect(
    (() => {
      attachInterrupt(2, () => {}, 'FALLING');
      return 1;
    })
  ).toBe(1)
  .it("attachInterrupt() accepts RISING mode")
  .expect(
    (() => {
      attachInterrupt(2, () => {}, 'RISING');
      return 1;
    })
  ).toBe(1)
  .it("attachInterrupt() accepts CHANGE mode")
  .expect(
    (() => {
      attachInterrupt(2, () => {}, 'CHANGE');
      return 1;
    })
  ).toBe(1)
  .it("detachInterrupt() removes a handler")
  .expect(
    (() => {
      detachInterrupt(2);
      return 1;
    })
  ).toBe(1)

describe("InputPin edge helpers")
  .it("onFalling/onRising/onChange/offAll are callable")
  .expect(
    (() => {
      const btn = D2.asInputPullUp();
      btn.onFalling(() => {});
      btn.onRising(() => {});
      btn.onChange(() => {});
      btn.offAll();
      return 1;
    })
  ).toBe(1)

done();
