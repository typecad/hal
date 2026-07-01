import { describe, it, expect } from "vitest";
import { emitRuntimeHeader } from "../../../packages/cuttlefish/src/ui/runtime-header";

// Focused tests for the C++ runtime's rich-text (inline run) support. These
// assert the header string contains the new structures and draw dispatch; full
// pixel parity between preview and device is covered by the lowering tests +
// showcase compile.

describe("C++ runtime rich-text support", () => {
  const header = emitRuntimeHeader();

  it("declares a UIRichRun struct with the run fields", () => {
    expect(header).toMatch(/struct\s+UIRichRun\s*\{/);
    expect(header).toContain("linkTarget");
  });

  it("declares ui_draw_rich_text", () => {
    expect(header).toMatch(/void\s+ui_draw_rich_text\s*\(/);
  });

  it("the NODE_TEXT branch dispatches to ui_draw_rich_text when the node has runs", () => {
    expect(header).toMatch(/runCount\s*>\s*0[\s\S]*?ui_draw_rich_text/);
  });

  it("declares a run hit-test helper for inline links", () => {
    expect(header).toMatch(/ui_rich_link_hit/);
  });

  it("ui_touch_up consults the run hit-test for tapped rich-text nodes", () => {
    expect(header).toMatch(/ui_rich_link_hit[\s\S]*?ui_navigate/);
  });
});
