import { describe, it, expect } from "vitest";
import { generateTouchAdapter } from "../../../packages/cuttlefish/src/api/shared/display-profile";

describe("FT6336U touch adapter", () => {
  const touch = {
    library: "FT6336U" as const,
    i2cAddress: 0x38,
    resetPin: 4,
    irq: 14,
    calibration: { xMin: 0, xMax: 320, yMin: 0, yMax: 480 },
  };

  const t = generateTouchAdapter(touch as any);

  it("includes Wire + RAK14014_FT6336U", () => {
    expect(t.includes).toContain("#include <Wire.h>");
    expect(t.includes).toContain("#include <RAK14014_FT6336U.h>");
  });

  it("declares FT6336U with the I2C address", () => {
    expect(t.declaration).toMatch(/FT6336U\s+__tc_touch\s*\(\s*0x38\s*\)/);
  });

  it("emits the hardware-reset sequence in touch_init when resetPin is set", () => {
    expect(t.functions).toContain("pinMode(4, OUTPUT);");
    expect(t.functions).toContain("digitalWrite(4, LOW);");
    expect(t.functions).toContain("delay(10);");
    expect(t.functions).toContain("digitalWrite(4, HIGH);");
    expect(t.functions).toContain("delay(500);");
    expect(t.functions).toMatch(/__tc_touch\.begin\(Wire,\s*0x38\)/);
  });

  it("touch_isTouched gates on read_td_status() > 0", () => {
    expect(t.functions).toContain("__tc_touch.read_td_status() > 0");
  });

  it("touch_readRaw calls scan() and reads tp[0].x / tp[0].y", () => {
    expect(t.functions).toContain("__tc_touch.scan()");
    expect(t.functions).toContain("__tp.tp[0].x");
    expect(t.functions).toContain("__tp.tp[0].y");
    // Synthesizes a z from touch_count (no real pressure on capacitive).
    expect(t.functions).toMatch(/__tp\.touch_count > 0\)\s*\?\s*255\s*:\s*0/);
  });

  it("omits the reset sequence when resetPin is absent", () => {
    const noReset = generateTouchAdapter({
      library: "FT6336U",
      i2cAddress: 0x38,
      calibration: { xMin: 0, xMax: 320, yMin: 0, yMax: 480 },
    } as any);
    expect(noReset.functions).not.toContain("pinMode(4, OUTPUT);");
    expect(noReset.functions).not.toContain("digitalWrite(4, LOW);");
    expect(noReset.functions).toMatch(/__tc_touch\.begin\(Wire,\s*0x38\)/);
  });

  it("defaults i2cAddress to 0x38 when unset", () => {
    const defaulted = generateTouchAdapter({
      library: "FT6336U",
      calibration: { xMin: 0, xMax: 320, yMin: 0, yMax: 480 },
    } as any);
    expect(defaulted.declaration).toMatch(/FT6336U\s+__tc_touch\s*\(\s*0x38\s*\)/);
    expect(defaulted.functions).toMatch(/__tc_touch\.begin\(Wire,\s*0x38\)/);
  });
});
