import { describe, it, expect } from "vitest";
import { modeTablePolyfill } from "../../../../packages/cuttlefish/src/safety/runtime/mode-table";
import { voterPolyfill } from "../../../../packages/cuttlefish/src/safety/runtime/vote";

describe("voter C++ (v2 — __tc_gpio_read)", () => {
  const tableSrc = modeTablePolyfill().helperFunctions.join("\n");
  const voterSrc = voterPolyfill().helperFunctions.join("\n");

  it("mode-mismatch branch returns PinModeMismatch when mode is Output", () => {
    expect(voterSrc).toContain("if ((mode != TrackedMode::Input) && (mode != TrackedMode::InputPullup) && (mode != TrackedMode::InputPulldown))");
    expect(voterSrc).toContain("SafetyFaultCode::PinModeMismatch");
  });

  it("accepts InputPulldown as a valid read mode (no false PinModeMismatch)", () => {
    expect(voterSrc).toContain("TrackedMode::InputPulldown");
  });

  it("mode-unknown branch returns PinModeUnknown for untracked pins", () => {
    expect(voterSrc).toContain("if (mode == TrackedMode::Unknown)");
    expect(voterSrc).toContain("SafetyFaultCode::PinModeUnknown");
  });

  it("vote-disagreement branch fires when reads differ", () => {
    expect(voterSrc).toContain("if ((r0 == r1) && (r1 == r2))");
    expect(voterSrc).toContain("SafetyFaultCode::VoteDisagreement");
  });

  it("ok branch sets status=OK and value when all three reads agree", () => {
    expect(voterSrc).toContain("result.status = SafetyStatus::Ok");
    expect(voterSrc).toContain("result.value  = r0 ? 0xFFFFFFFFU : 0x00000000U");
  });

  it("fault branches set status=FAULT", () => {
    expect(voterSrc).toContain("result.status   = SafetyStatus::Fault");
  });

  it("voter calls __tc_gpio_read (NOT digitalRead) — MCU-agnostic", () => {
    expect(voterSrc).toContain("__tc_gpio_read(pin)");
    expect(voterSrc).not.toContain("digitalRead");
  });

  it("mode table includes InputPulldown with multi-bit value", () => {
    expect(tableSrc).toContain("InputPulldown = 0xC3C3C3C3U");
  });

  it("record_pin_mode takes uint32_t and casts (no 4-way switch)", () => {
    expect(tableSrc).toContain("inline void record_pin_mode(uint32_t pin, uint32_t mode)");
    expect(tableSrc).toContain("static_cast<TrackedMode>");
    expect(tableSrc).not.toContain("case 0U: g_pin_mode_table");
  });

  it("enums use uint32_t with Hamming-distance values", () => {
    expect(tableSrc).toContain("enum class TrackedMode : uint32_t");
    expect(tableSrc).toContain("Input         = 0x5A5A5A5AU");
    expect(tableSrc).toContain("Output        = 0xA5A5A5A5U");
  });

  it("voter depends on the mode-table polyfill", () => {
    expect(voterPolyfill().dependencies).toContain("safety_mode_table");
  });
});
