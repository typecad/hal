import { describe, done } from '@typecad/hal/testing';
// Timing suite, adapted to the thin Time class (the ambient Timing namespace
// and free delay()/millis()/micros() are gone — Time.now()/nowUs()/sleep()/
// busyWaitUs() lower to k_uptime_get/k_uptime_get_32/k_msleep/k_busy_wait).
import { Time } from '@typecad/hal';

describe("Time.now (monotonic milliseconds)")
  .it("Time.now() returns a non-negative value")
  .expect(
    (() => {
      const t = Time.now();
      return t >= 0 ? 1 : 0;
    })
  ).toBe(1)
  .it("Time.now() does not decrease")
  .expect(
    (() => {
      const a = Time.now();
      const b = Time.now();
      return b >= a ? 1 : 0;
    })
  ).toBe(1)

describe("Time.nowUs (monotonic microseconds)")
  .it("Time.nowUs() returns a non-negative value")
  .expect(
    (() => {
      const t = Time.nowUs();
      return t >= 0 ? 1 : 0;
    })
  ).toBe(1)
  .it("Time.nowUs() advances past a busy wait")
  .expect(
    (() => {
      const a = Time.nowUs();
      Time.busyWaitUs(5000);
      const b = Time.nowUs();
      return b > a ? 1 : 0;
    })
  ).toBe(1)

describe("Time sleeps")
  .it("Time.sleep(1) is callable without crashing")
  .expect(
    (() => {
      Time.sleep(1);
      return 1;
    })
  ).toBe(1)
  .it("Time.busyWaitUs(100) is callable without crashing")
  .expect(
    (() => {
      Time.busyWaitUs(100);
      return 1;
    })
  ).toBe(1)

done();
