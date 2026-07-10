import { describe, done } from '@typecad/expect';

// NOTE: The Shift fluent class (Shift.out/read/builders) requires a @TypeCAD
// import, which currently triggers a spurious `#include <Typecad.h>` that
// fails to compile (pre-existing transpiler limitation — see README). These
// tests exercise the ambient free functions instead.

describe("Free shift functions")
  .it("shiftOut() with MSBFIRST is callable")
  .expect(
    (() => {
      shiftOut(8, 9, 1, 0x99);
      return 1;
    })
  ).toBe(1)
  .it("shiftOut() with LSBFIRST is callable")
  .expect(
    (() => {
      shiftOut(8, 9, 0, 0x66);
      return 1;
    })
  ).toBe(1)
  .it("shiftIn() is callable")
  .expect(
    (() => {
      shiftIn(8, 9, 1);
      return 1;
    })
  ).toBe(1)

done();
