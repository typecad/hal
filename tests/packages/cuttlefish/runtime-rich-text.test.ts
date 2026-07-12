import { describe, it, expect } from "vitest";
import { emitRuntimeHeader } from "../../../packages/ui/src/ui-engine/runtime-header";

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

  it("can tint rich-text shadow passes with a foreground override", () => {
    // fgOverride uses the platform color type (UI_COLOR_T) so the same draw
    // path works for both RGB565 and RGB888 displays.
    expect(header).toMatch(/ui_draw_rich_text\([^)]*uint8_t useFgOverride = 0,\s*UI_COLOR_T fgOverride = 0/);
    expect(header).toMatch(/UI_COLOR_T fg = useFgOverride \? fgOverride : run->fg/);
    // The shadow pass enables the override (useFgOverride=1) and passes the
    // blended shadow color. maxWidth follows tsCol in the call, so tsCol is
    // matched as a leading argument rather than the trailing one.
    expect(header).toMatch(/textShadowCount > 0[\s\S]*ui_draw_rich_text\([^;]*,\s*1,\s*tsCol\s*,/);
  });

  it("clips rich-text draw work to the active target before drawing segments", () => {
    expect(header).toMatch(/ui_draw_rich_text[\s\S]*ui_display_target_width\(\)/);
    expect(header).toMatch(/ui_draw_rich_text[\s\S]*ui_display_target_height\(\)/);
    expect(header).toMatch(/ui_draw_rich_text[\s\S]*for \(uint16_t si = n->richSegStart; si < richSegEnd; si\+\+\)/);
    expect(header).toMatch(/ui_draw_rich_text[\s\S]*lineBottom <= targetTop \|\| lineTop >= targetBottom[\s\S]*continue/);
    expect(header).toMatch(/ui_draw_rich_text[\s\S]*segRight <= targetLeft \|\| segX >= targetRight[\s\S]*continue/);
  });

  it("declares a run hit-test helper for inline links", () => {
    expect(header).toMatch(/ui_rich_link_hit/);
  });

  it("ui_touch_up consults the run hit-test for tapped rich-text nodes", () => {
    expect(header).toMatch(/ui_rich_link_hit[\s\S]*?ui_navigate/);
  });
});
