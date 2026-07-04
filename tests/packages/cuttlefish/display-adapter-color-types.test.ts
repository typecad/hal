import { describe, it, expect } from "vitest";
import { generateDisplayAdapter } from "../../../packages/cuttlefish/src/api/shared/display-adapter";

describe("adapter color param types track UI_COLOR_T", () => {
  it("ILI9341 draw functions accept the HAL color type", () => {
    const a = generateDisplayAdapter({
      driver: "ili9341",
      width: 320,
      height: 240,
      colorFormat: "rgb565",
      rotation: 0,
    } as any);
    expect(a.functions).toMatch(/display_targetDrawPixel\([^)]*UI_COLOR_T color\)/);
    expect(a.functions).toMatch(/display_targetFillRect\([^)]*UI_COLOR_T color\)/);
  });

  it("ST7796 fillScreen accepts UI_COLOR_T (rgb565 path)", () => {
    // ST7796 defines the full canvas + target draw shim family itself (parity
    // with ILI9341). fillScreen takes UI_COLOR_T and casts to uint16_t.
    const a = generateDisplayAdapter({
      driver: "st7796",
      width: 320,
      height: 480,
      colorFormat: "rgb565",
      rotation: 0,
    } as any);
    expect(a.functions).toMatch(/display_fillScreen\(UI_COLOR_T color\)/);
    expect(a.functions).toMatch(/display_targetDrawPixel\([^)]*UI_COLOR_T color\)/);
  });

  it("ST7796 rgb666 throws (library hardcodes 565 in its init sequence)", () => {
    // The Adafruit_ST7796S init array sets COLMOD=0x55 (RGB565). Requesting
    // rgb666 throws a clear error rather than emitting an unrunnable push path.
    expect(() =>
      generateDisplayAdapter({
        driver: "st7796",
        width: 320,
        height: 480,
        colorFormat: "rgb666",
        rotation: 0,
      } as any),
    ).toThrow(/rgb666/i);
  });
});
