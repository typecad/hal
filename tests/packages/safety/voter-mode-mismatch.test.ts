import { describe, it, expect } from "vitest";
import { modeTablePolyfill } from "../../../packages/safety/src/runtime/mode-table";
import { voterPolyfill } from "../../../packages/safety/src/runtime/vote";

describe("voter C++ (v2 — __tc_gpio_read)", () => {
  const tableSrc = modeTablePolyfill().helperFunctions.join("\n");
  const voterSrc = voterPolyfill().helperFunctions.join("\n");

  it("mode-mismatch branch returns PinModeMismatch when mode is Output", () => {
    expect(voterSrc).toContain("if ((mode != TrackedMode::Input) && (mode != TrackedMode::InputPullup))");
    expect(voterSrc).toContain("SafetyFaultCode::PinModeMismatch");
  });

  it("mode-unknown branch returns PinModeUnknown for untracked pins", () => {
    expect(voterSrc).toContain("if (mode == TrackedMode::Unknown)");
    expect(voterSrc).toContain("SafetyFaultCode::PinModeUnknown");
  });

  it("vote-disagreement branch fires when reads differ", () => {
    expect(voterSrc).toContain("if ((r0 == r1) && (r1 == r2))");
    expect(voterSrc).toContain("SafetyFaultCode::VoteDisagreement");
  });

  it("ok branch sets ok=true and value=r0 when all three reads agree", () => {
    expect(voterSrc).toContain("result.ok    = true;");
    expect(voterSrc).toContain("result.value = r0;");
  });

  it("voter calls __tc_gpio_read (NOT digitalRead) — MCU-agnostic", () => {
    expect(voterSrc).toContain("__tc_gpio_read(pin)");
    expect(voterSrc).not.toContain("digitalRead");
  });

  it("mode table includes InputPulldown (5-value enum)", () => {
    expect(tableSrc).toContain("InputPulldown = 4U");
  });

  it("record_pin_mode takes uint8_t and casts (no 4-way switch)", () => {
    expect(tableSrc).toContain("inline void record_pin_mode(uint8_t pin, uint8_t mode)");
    expect(tableSrc).toContain("static_cast<TrackedMode>(mode)");
    expect(tableSrc).not.toContain("case 0U: g_pin_mode_table");
  });

  it("voter depends on the mode-table polyfill", () => {
    expect(voterPolyfill().dependencies).toContain("safety_mode_table");
  });
});
