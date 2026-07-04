import { describe, it, expect } from "vitest";
import { generateTouchPollBody } from "../../../packages/cuttlefish/src/emit/emitters/ui-emitter";

describe("generateTouchPollBody", () => {
  const profile320x480 = { width: 320, height: 480, rotation: 1 };

  it("emits the minPressure gate for resistive (XPT2046) touch", () => {
    const body = generateTouchPollBody({
      library: "XPT2046_Touchscreen",
      minPressure: 10,
      calibration: { xMin: 375, xMax: 3950, yMin: 200, yMax: 3750 },
      profile: profile320x480,
    });
    expect(body).toContain("if (__rawZ >= 10) {");
    expect(body).toContain("ui_handle_touch(__tx, __ty);");
    expect(body).toContain("ui_handle_no_touch();");
  });

  it("omits the minPressure gate for capacitive (FT6336U) touch", () => {
    const body = generateTouchPollBody({
      library: "FT6336U",
      minPressure: 10,
      calibration: { xMin: 0, xMax: 320, yMin: 0, yMax: 480 },
      profile: profile320x480,
    });
    expect(body).not.toContain("__rawZ >= 10");
    expect(body).not.toContain("if (__rawZ >= 10)");
    expect(body).toContain("ui_handle_touch(__tx, __ty);");
  });

  it("FT6336U still maps raw coords through calibration (rotation-aware)", () => {
    const body = generateTouchPollBody({
      library: "FT6336U",
      minPressure: 10,
      calibration: { xMin: 0, xMax: 320, yMin: 0, yMax: 480 },
      profile: profile320x480,
    });
    // rotation 1 (landscape, invertX+invertY): map(raw, min, max, profileDim, 0)
    // profileDim is the profile's width/height (320/480) — the rotation-aware
    // axis swap happens in hardware/driver, not in this map.
    expect(body).toMatch(/map\(__rawX,\s*0,\s*320,\s*320,\s*0\)/);
    expect(body).toMatch(/map\(__rawY,\s*0,\s*480,\s*480,\s*0\)/);
  });

  it("SDL branch unchanged (identity map, no minPressure gate)", () => {
    const body = generateTouchPollBody({
      library: "sdl",
      minPressure: 10,
      calibration: { xMin: 0, xMax: 320, yMin: 0, yMax: 240 },
      profile: { width: 320, height: 240, rotation: 0 },
    });
    expect(body).toMatch(/map\(__rawX,\s*0,\s*320,\s*0,\s*320\)/);
    expect(body).not.toContain("__rawZ >= 10");
  });

  it("returns null when library is undefined (no-touch path)", () => {
    const body = generateTouchPollBody({
      library: undefined,
      minPressure: 10,
      calibration: { xMin: 0, xMax: 100, yMin: 0, yMax: 100 },
      profile: profile320x480,
    });
    expect(body).toBeNull();
  });
});
