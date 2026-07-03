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

  it("ST7796 rgb666 fillScreen accepts UI_COLOR_T (uint32_t)", () => {
    // ST7796 does not define display_target* draw functions itself (those come
    // from whichever adapter supplies them); it defines fillScreen + writePixels.
    // Under rgb666, fillScreen takes the widened 888 type.
    const a = generateDisplayAdapter({
      driver: "st7796",
      width: 320,
      height: 240,
      colorFormat: "rgb666",
      rotation: 0,
    } as any);
    expect(a.functions).toMatch(/display_fillScreen\(UI_COLOR_T color\)/);
  });
});
