import { describe, expect, it } from "vitest";
import { emitImageTables, type UIImageAsset } from "../../../packages/ui/src/ui-engine/image-assets";

describe("UI image asset emission", () => {
  const asset: UIImageAsset = {
    id: "logo",
    width: 2,
    height: 1,
    data: [0xf800, 0x07e0],
  };

  it("emits UI_COLOR_T image arrays so tables match the runtime image pointer type", () => {
    expect(emitImageTables([asset], "rgb565")).toContain("static const UI_COLOR_T __ui_img_logo_data[]");
  });

  it("widens RGB565 asset pixels for RGB888 targets", () => {
    const tables = emitImageTables([asset], "rgb888");

    expect(tables).toContain("0xff0000");
    expect(tables).toContain("0x00ff00");
    expect(tables).not.toContain("0xf800");
    expect(tables).not.toContain("0x07e0");
  });
});
