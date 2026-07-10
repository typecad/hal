import { describe, done } from '@typecad/expect';

// NOTE: The Pulse fluent class (Pulse.on(pin).high()) requires a @TypeCAD
// import, which currently triggers a spurious `#include <Typecad.h>` that
// fails to compile (pre-existing transpiler limitation — see README). These
// tests exercise the ambient free functions instead. A timeout is always
// passed so pulseIn/pulseInLong do not block waiting for a signal that is
// not wired up on the bare Uno.

describe("Free pulse functions")
  .it("pulseIn() is callable")
  .expect(
    (() => {
      pulseIn(7, 1, 100);
      return 1;
    })
  ).toBe(1)
  .it("pulseIn() measures a value with a timeout")
  .expect(
    (() => {
      const v = pulseIn(7, 1, 2000);
      return v >= 0 ? 1 : 0;
    })
  ).toBe(1)
  .it("pulseInLong() is callable")
  .expect(
    (() => {
      pulseInLong(7, 1, 100);
      return 1;
    })
  ).toBe(1)

done();
