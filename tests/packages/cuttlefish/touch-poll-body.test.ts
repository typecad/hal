import { describe, it, expect } from "vitest";
import { generateTouchPollBody } from "../../../packages/cuttlefish/src/emit/emitters/ui-emitter";

describe("generateTouchPollBody", () => {
  const st7796Landscape = {
    width: 480,
    height: 320,
    nativeWidth: 320,
    nativeHeight: 480,
    rotation: 1,
  };

  it("emits the minPressure gate for resistive (XPT2046) touch", () => {
    const body = generateTouchPollBody({
      library: "XPT2046_Touchscreen",
      minPressure: 10,
      calibration: { xMin: 375, xMax: 3950, yMin: 200, yMax: 3750 },
      profile: st7796Landscape,
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
      profile: st7796Landscape,
    });
    expect(body).not.toContain("__rawZ >= 10");
    expect(body).not.toContain("if (__rawZ >= 10)");
    expect(body).toContain("ui_handle_touch(__tx, __ty);");
  });

  it("FT6336U maps raw coords through calibration and rotation", () => {
    const body = generateTouchPollBody({
      library: "FT6336U",
      minPressure: 10,
      calibration: { xMin: 0, xMax: 320, yMin: 0, yMax: 480 },
      profile: st7796Landscape,
    });
    // rotation 1: native raw Y becomes screen X, and native raw X is inverted
    // into screen Y. The effective viewport is 480x320.
    expect(body).toMatch(/int16_t __tx = map\(__rawY,\s*0,\s*480,\s*0,\s*480\)/);
    expect(body).toMatch(/int16_t __ty = 320 - \(map\(__rawX,\s*0,\s*320,\s*0,\s*320\)\)/);
    expect(body).toContain("else if (__tx >= 480) __tx = 479;");
    expect(body).toContain("else if (__ty >= 320) __ty = 319;");
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
      profile: st7796Landscape,
    });
    expect(body).toBeNull();
  });
});
