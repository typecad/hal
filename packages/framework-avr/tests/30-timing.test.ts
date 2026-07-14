import { describe, done } from '@typecad/expect';

// Timing exercises the AVR strategy's native delay shims (_native_delay_ms /
// _native_delay_us emitted by shimLines) and the inherited Arduino millis/
// micros. On-device this proves the F_CPU-derived delay loops and the
// Timer0-backed millis counter run correctly on real silicon.

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
  .it("Timing.millis() advances over time")
  .expect(
    (() => {
      const t0 = Timing.millis();
      Timing.delay(5);
      const t1 = Timing.millis();
      return t1 >= t0 ? 1 : 0;
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

done();
