import { describe, done } from '@typecad/hal/testing';

// NOTE: The Shift fluent class (Shift.out/read/builders) lowers to a C++ class
// method chain (Shift::write(...).clock_(...).msbFirst()) that requires a C++
// class definition the transpiler does not currently generate, so it won't
// compile as standalone Arduino C++. The fluent API is covered by vitest
// codegen tests (tests/pulse-shift-random.test.ts covers the Shift class
// patterns). These hardware tests exercise the ambient free functions instead.

// Black Pill: numeric pins follow the port-block scheme (PA<n> = n); 2/3 are
// PA2/PA3 (USART2 pads, unclaimed — the console rides the USB CDC port).

describe("Free shift functions")
  .it("shiftOut() with MSBFIRST is callable")
  .expect(
    (() => {
      shiftOut(2, 3, 1, 0x99);
      return 1;
    })
  ).toBe(1)
  .it("shiftOut() with LSBFIRST is callable")
  .expect(
    (() => {
      shiftOut(2, 3, 0, 0x66);
      return 1;
    })
  ).toBe(1)
  .it("shiftIn() is callable")
  .expect(
    (() => {
      shiftIn(2, 3, 1);
      return 1;
    })
  ).toBe(1)

done();
