import { describe, done } from '@typecad/expect';
import { INPUT_PULLUP } from '@typecad/board';

// Board-agnostic: raw pin number 7 (PA7 on the Black Pill, D7 on the Uno,
// GPIO7 on the ESP32 devkit). It is pulled up before the pulse calls so the
// floating pad idles at a defined level — pulseIn(7, 1, …) then cleanly
// times out waiting for a LOW→HIGH edge that never comes, bounded by the
// explicit timeout on every call. INPUT_PULLUP (not INPUT_PULLDOWN) because
// AVR cores do not declare INPUT_PULLDOWN at all, and pull-ups exist on
// every target this suite runs on.
pinMode(7, INPUT_PULLUP);

// NOTE: The Pulse fluent class (Pulse.on(pin).high()) lowers to a C++ class
// method chain (Pulse::on(pin).high()) that requires a C++ class definition
// the transpiler does not currently generate, so it won't compile as
// standalone Arduino C++. The fluent API is covered by vitest codegen tests
// (tests/pulse-shift-random.test.ts). These hardware tests exercise the
// ambient free functions instead. A timeout is always passed so
// pulseIn/pulseInLong do not block waiting for a signal that is not wired
// up on the bare board.

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
