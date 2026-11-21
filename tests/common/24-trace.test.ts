import { describe, done } from '@typecad/hal/testing';
// Trace suite — the user-event markers on the runtime trace timeline. Both
// verbs print one [TR:EV: console line (timestamps from the kernel uptime
// clock). Callable-coverage here: with zephyr.trace disabled (the suite
// configs don't enable it), the marks still lower and compile — the
// per-value formatting path is what this protects.
import { Trace } from '@typecad/hal';

describe("Trace.mark()")
  .it("mark() with a literal name is callable")
  .expect(
    (() => {
      Trace.mark('suite-mark');
      return 1;
    })
  ).toBe(1)

describe("Trace.event()")
  .it("event() with an integer value is callable")
  .expect(
    (() => {
      Trace.event('suite-count', 3);
      return 1;
    })
  ).toBe(1)
  .it("event() with a fractional value formats through the number path")
  .expect(
    (() => {
      Trace.event('suite-avg', 1.25);
      return 1;
    })
  ).toBe(1)

done();
