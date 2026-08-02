import { describe, it, expect } from "vitest";
import { resolveScrollConfig, DEFAULT_SCROLL_CANVAS_BUDGET_BYTES } from "../../../packages/cuttlefish/src/api/shared/display-profile";
import { buildTargetHasPsram } from "../../../packages/framework-arduino/src/displays/psram";

// PSRAM detection moved out of cuttlefish: resolveScrollConfig now relies solely
// on the framework-supplied `psram` boolean flag (cuttlefish no longer parses
// Arduino FQBN strings). The FQBN→psram derivation lives in
// @typecad/framework-arduino (buildTargetHasPsram) and is exercised separately
// below. resolveScrollConfig is tested with the resolved flag here.
describe("resolveScrollConfig: PSRAM-aware canvas budget (flag-based)", () => {
  it("uses the small no-PSRAM default when the psram flag is unset", () => {
    const s = resolveScrollConfig({ touch: false }, {});
    expect(s.scrollCanvasBudgetBytes).toBe(DEFAULT_SCROLL_CANVAS_BUDGET_BYTES);
  });

  it("uses the small no-PSRAM default when the psram flag is false", () => {
    const s = resolveScrollConfig({ touch: false }, { psram: false });
    expect(s.scrollCanvasBudgetBytes).toBe(DEFAULT_SCROLL_CANVAS_BUDGET_BYTES);
  });

  it("raises the budget when the framework-supplied psram flag is true", () => {
    const s = resolveScrollConfig({ touch: false }, { psram: true });
    expect(s.scrollCanvasBudgetBytes).toBeGreaterThan(DEFAULT_SCROLL_CANVAS_BUDGET_BYTES);
  });

  it("an explicit scrollCanvasBudgetBytes override always wins", () => {
    const s = resolveScrollConfig(
      { touch: false, scroll: { scrollCanvasBudgetBytes: 12345 } },
      { psram: true },
    );
    expect(s.scrollCanvasBudgetBytes).toBe(12345);
  });
});

// The Arduino FQBN PSRAM= parser moved to @typecad/framework-arduino. Verify it
// still maps the FQBN board-option suffix to a boolean the way the (removed)
// cuttlefish path did, so the transpile flow that derives the `psram` flag from
// the build target keeps producing the raised budget for PSRAM targets.
describe("framework-arduino buildTargetHasPsram (FQBN parser)", () => {
  it("returns false when there is no PSRAM option", () => {
    expect(buildTargetHasPsram("esp32:esp32:esp32s3")).toBe(false);
    expect(buildTargetHasPsram(undefined)).toBe(false);
  });

  it("returns true for OPI PSRAM", () => {
    expect(buildTargetHasPsram("esp32:esp32:esp32s3:PSRAM=opi")).toBe(true);
  });

  it("returns true for QSPI/IO PSRAM", () => {
    expect(buildTargetHasPsram("esp32:esp32:esp32s3:PSRAM=io")).toBe(true);
  });

  it("returns false for an explicit disabled value", () => {
    expect(buildTargetHasPsram("esp32:esp32:esp32s3:PSRAM=disabled")).toBe(false);
    expect(buildTargetHasPsram("esp32:esp32:esp32s3:PSRAM=none")).toBe(false);
  });
});
