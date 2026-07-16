import { describe, done } from '@typecad/expect';

// @typecad-skip-target esp32: ESP32 does not expose the AVR watchdog API.

// NOTE: The WDT API is entirely void — enable()/reset()/disable() return no
// value, so on bare metal there is nothing deterministic to assert on beyond
// "the call ran without trapping". These tests are therefore intentionally
// smoke (return 1). The correctness of the *emitted* C++ (e.g. that the string
// '250ms' lowers to the wdt_enable(WDTO_250MS) macro rather than being passed
// raw) is pinned by tests/packages/hal/hal-output-correctness.test.ts, which
// asserts on the transpiled output rather than on hardware execution.

describe("WDT namespace")
  .it("WDT.reset() runs without trapping")
  .expect(
    (() => {
      WDT.reset();
      return 1;
    })
  ).toBe(1)
  .it("WDT.enable() then WDT.disable() runs without trapping")
  .expect(
    (() => {
      WDT.enable('250ms');
      WDT.disable();
      return 1;
    })
  ).toBe(1)
  .it("WDT.enable() + WDT.reset() + WDT.disable() full cycle runs")
  .expect(
    (() => {
      WDT.enable('500ms');
      WDT.reset();
      WDT.disable();
      return 1;
    })
  ).toBe(1)

done();
