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
    expect(t.declaration).toContain("__tc_touch_cached_x");
    expect(t.declaration).toContain("__tc_touch_cached_valid");
  });

  it("emits the hardware-reset sequence in touch_init when resetPin is set", () => {
    expect(t.functions).toContain("pinMode(4, OUTPUT);");
    expect(t.functions).toContain("digitalWrite(4, LOW);");
    expect(t.functions).toContain("delay(10);");
    expect(t.functions).toContain("digitalWrite(4, HIGH);");
    expect(t.functions).toContain("delay(500);");
    expect(t.functions).toMatch(/__tc_touch\.begin\(Wire,\s*0x38\)/);
    expect(t.functions).toContain("Wire.setClock(400000);");
  });

  it("touch_isTouched uses a cached 5-byte I2C burst read", () => {
    expect(t.functions).toContain("__tc_ft6336u_read_block(0x02, buf, 5)");
    expect(t.functions).toContain("uint8_t count = buf[0] & 0x0F;");
    expect(t.functions).toContain("__tc_touch_cached_x");
    expect(t.functions).toContain("__tc_touch_cached_y");
    expect(t.functions).not.toContain("__tc_touch.read_td_status()");
  });

  it("touch_readRaw returns the cached sample instead of calling scan()", () => {
    expect(t.functions).toContain("if (x) *x = __tc_touch_cached_x;");
    expect(t.functions).toContain("if (y) *y = __tc_touch_cached_y;");
    expect(t.functions).toContain("if (z) *z = __tc_touch_cached_z;");
    expect(t.functions).not.toContain("__tc_touch.scan()");
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

  it("uses an explicit I2C frequency when provided", () => {
    const fast = generateTouchAdapter({
      library: "FT6336U",
      i2cAddress: 0x38,
      i2cFrequency: 1000000,
      calibration: { xMin: 0, xMax: 320, yMin: 0, yMax: 480 },
    } as any);

    expect(fast.functions).toContain("Wire.setClock(1000000);");
  });
});
