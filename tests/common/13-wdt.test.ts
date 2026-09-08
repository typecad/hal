import { describe, done } from '@typecad/hal/testing';
// The watchdog suite. The IWDG cannot be disabled once started on STM32, so
// the timeout is generous (8 s) and the suite finishes in milliseconds; the
// idle loop after SUITE_END may reset the board harmlessly once the host
// has detached. The API is void — these are smoke assertions (the call ran
// without trapping); emitted-C++ correctness is pinned by host-side tests.
import { Watchdog } from '@typecad/hal';

describe("Watchdog")
  .it("enable() arms the watchdog without trapping")
  .expect(
    (() => {
      const dog = new Watchdog(8000);
      dog.enable();
      return 1;
    })
  ).toBe(1)
  .it("feed() keeps it alive without trapping")
  .expect(
    (() => {
      const dog = new Watchdog(8000);
      dog.enable();
      dog.feed();
      return 1;
    })
  ).toBe(1)

done();
