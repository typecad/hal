import { describe, it, expect } from "vitest";
import { modeTablePolyfill } from "../../../packages/safety/src/runtime/mode-table";
import { voterPolyfill } from "../../../packages/safety/src/runtime/vote";

describe("voter C++ — pin-mode branches", () => {
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

  it("mode table records INPUT/OUTPUT/INPUT_PULLUP correctly", () => {
    expect(tableSrc).toContain("case 0U: g_pin_mode_table[pin] = TrackedMode::Input;");
    expect(tableSrc).toContain("case 1U: g_pin_mode_table[pin] = TrackedMode::Output;");
    expect(tableSrc).toContain("case 2U: g_pin_mode_table[pin] = TrackedMode::InputPullup;");
  });

  it("voter depends on the mode-table polyfill", () => {
    expect(voterPolyfill().dependencies).toContain("safety_mode_table");
  });
});
