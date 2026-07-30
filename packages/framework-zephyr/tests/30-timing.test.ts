import { describe, done } from '@typecad/expect';
import { Timing } from '@typecad/hal';

// On-device timing tests for the Zephyr framework. Proves k_msleep /
// k_uptime_get_32 / k_busy_wait lowering runs end-to-end on metal.

describe("Timing")
  .it("millis increases over time")
  .expect(
    (() => {
      const start: number = Timing.millis();
      Timing.delay(10);
      const end: number = Timing.millis();
      return end > start ? 1 : 0;
    })
  ).toBe(1)
  .it("delay blocks for approximately the requested duration")
  .expect(
    (() => {
      const start: number = Timing.millis();
      Timing.delay(50);
      const elapsed: number = Timing.millis() - start;
      // Allow generous slack (embedded RTOS scheduling) — just confirm it blocked.
      return elapsed >= 40 ? 1 : 0;
    })
  ).toBe(1)
  .it("delay_microseconds runs without crashing")
  .expect(
    (() => {
      Timing.delayMicroseconds(100);
      return 1;
    })
  ).toBe(1)
  .it("micros increases over time")
  .expect(
    (() => {
      const start: number = Timing.micros();
      Timing.delayMicroseconds(500);
      const end: number = Timing.micros();
      return end > start ? 1 : 0;
    })
  ).toBe(1)

done();
