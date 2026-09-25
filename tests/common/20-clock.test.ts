import { describe, done } from '@typecad/hal/testing';
// Wall-clock round-trip over the rtc alias: set a known epoch, read it
// back, and assert the value moved forward but stayed within a loose
// window (the shim's counter ticks, so seconds advance at wall rate —
// the readback lands within [set, set+5] for a fast test body).
import { Clock, Time } from '@typecad/hal';

describe("Clock set/now round-trip")
  .it("now() returns the epoch set() wrote, advancing with wall time")
  .expect(
    (() => {
      Clock.set(1710000000);
      const t = Clock.now();
      // in-range check folded to booleans the protocol can compare
      const afterSet = t >= 1710000000;
      const nearNow = t < 1710000005;
      if (afterSet && nearNow) {
        return 1;
      }
      return 0;
    })
  ).toBe(1)
  .it("now() advances over a real second")
  .expect(
    (() => {
      const a = Clock.now();
      // Poll at 250ms (bounded to ~1.25s): the shim's counter ticks at
      // wall rate, so a fresh read must cross the next second boundary.
      let b = a;
      let waits = 0;
      while (b === a && waits < 5) {
        Time.sleep(250);
        b = Clock.now();
        waits = waits + 1;
      }
      return b > a ? 1 : 0;
    })
  ).toBe(1)

done();
