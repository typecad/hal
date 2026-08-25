import { describe, done } from '@typecad/expect';

// @typecad-skip-target samd21: Zephyr's samd21 devicetree exposes no watchdog
// node at all (no wdt in samd21.dtsi), so there is no watchdog device to
// exercise — the framework lowers wdt.* to comments and flags usage. This is
// a silicon/devicetree limitation, not a framework gap.

// NOTE: The WDT API is entirely void — enable()/reset()/disable() return no
// value, so on bare metal there is nothing deterministic to assert on beyond
// "the call ran without trapping". These tests are therefore intentionally
// smoke (return 1). The correctness of the *emitted* C++ (e.g. that the string
// '250ms' lowers to the wdt_enable(WDTO_250MS) macro rather than being passed
// raw) is pinned by tests/packages/hal/hal-output-correctness.test.ts, which
// asserts on the transpiled output rather than on hardware execution.
//
// Black Pill / STM32: the independent watchdog (IWDG) CANNOT be disabled once
// started — Zephyr's wdt_disable() returns -EPERM and the counter keeps
// running. The timeouts below are therefore long (8 s): the whole file
// finishes in milliseconds and the idle loop after SUITE_END may reset the
// board harmlessly once the host has already detached. A short timeout
// ('250ms') would reset the board mid-protocol and time out the runner.

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
      WDT.enable('8s');
      WDT.disable();
      return 1;
    })
  ).toBe(1)
  .it("WDT.enable() + WDT.reset() + WDT.disable() full cycle runs")
  .expect(
    (() => {
      WDT.enable('8s');
      WDT.reset();
      WDT.disable();
      return 1;
    })
  ).toBe(1)

done();
