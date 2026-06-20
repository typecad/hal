import { describe, it, expect } from "vitest";
import { emitRuntimeHeader } from "@typecad/cuttlefish/ui/runtime-header";

describe("C++ reactive runtime header", () => {
  const header = emitRuntimeHeader();

  it("declares the UINode, UITransition, and UIBinding structs", () => {
    expect(header).toMatch(/struct\s+UINode/);
    expect(header).toMatch(/struct\s+UITransition/);
    expect(header).toMatch(/struct\s+UIBinding/);
  });

  it("declares ui_mark_dirty for marking nodes dirty", () => {
    expect(header).toContain("ui_mark_dirty");
  });

  it("declares the per-frame ui_tick driver", () => {
    expect(header).toContain("ui_tick");
  });

  it("contains a color lerp helper for transitions", () => {
    expect(header).toContain("lerp_color");
  });

  it("contains press/release entry points", () => {
    expect(header).toContain("ui_on_press");
    expect(header).toContain("ui_on_release");
  });

  it("declares the draw dispatch (NODE_FILL / NODE_TEXT)", () => {
    expect(header).toContain("NODE_FILL");
    expect(header).toContain("NODE_TEXT");
  });

  it("is wrapped in an include guard", () => {
    expect(header).toMatch(/#ifndef\s+__TC_UI_RUNTIME/);
    expect(header).toMatch(/#define\s+__TC_UI_RUNTIME/);
    expect(header).toContain("#endif");
  });
});
