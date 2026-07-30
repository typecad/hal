import { describe, done } from '@typecad/expect';
import { Timing } from '@typecad/hal';

// On-device timer tests for the Zephyr framework. Zephyr's RTOS timing is
// kernel-backed (k_msleep / k_uptime_get_32); these confirm the timing surface
// behaves correctly over repeated calls.

describe("Timers")
  .it("repeated delay calls accumulate elapsed time")
  .expect(
    (() => {
      const start: number = Timing.millis();
      for (let i = 0; i < 5; i++) {
        Timing.delay(10);
      }
      const elapsed: number = Timing.millis() - start;
      return elapsed >= 40 ? 1 : 0;
    })
  ).toBe(1)
  .it("millis is monotonic across calls")
  .expect(
    (() => {
      const a: number = Timing.millis();
      const b: number = Timing.millis();
      const c: number = Timing.millis();
      return (b >= a && c >= b) ? 1 : 0;
    })
  ).toBe(1)
  .it("delay then read runs without crashing")
  .expect(
    (() => {
      Timing.delay(5);
      const t: number = Timing.millis();
      return t >= 0 ? 1 : 0;
    })
  ).toBe(1)

done();
