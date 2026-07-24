import { describe, it, expect } from "vitest";
import { emitRuntimeHeader } from "@typecad/ui/ui-engine/runtime-header";

// `await ui.onTap()` — runtime side: a tap counter + last-tapped-node that the
// async state machine polls. See docs/superpowers/specs/2026-06-27-ui-ontap-awaitable-design.md
describe("ui.onTap runtime source (awaitable tap notifications)", () => {
  const header = emitRuntimeHeader();

  it("declares the awaitable tap counter globals", () => {
    expect(header).toMatch(/volatile\s+uint32_t\s+__ui_tap_seq\s*=\s*0/);
    expect(header).toMatch(/volatile\s+int16_t\s+__ui_tap_node\s*=\s*-1/);
  });

  it("bumps __ui_tap_seq inside ui_touch_up (after click/release dispatch)", () => {
    // The increment must be AFTER ui_dispatch(__ui_release_handlers) so onClick
    // always fires before the awaiter resumes ("both fire" semantics).
    // Accept either `++` or `= ... + 1`: volatile-qualified integers use the
    // explicit `+ 1` form under GCC 13+/IDF v6 (-Werror=volatile deprecates `++`).
    expect(header).toMatch(
      /ui_dispatch\(__ui_release_handlers[\s\S]*?__ui_tap_seq(?:\+\+| = __ui_tap_seq \+ 1)/,
    );
    expect(header).toContain("__ui_tap_node = __ui_touch_node");
  });
});
