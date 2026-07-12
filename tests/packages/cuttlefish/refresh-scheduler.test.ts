import { describe, it, expect } from "vitest";
import { emitRuntimeHeader } from "../../../packages/ui/src/ui-engine/runtime-header";

describe("e-ink dirty-rect refresh union", () => {
  const header = emitRuntimeHeader();

  it("defines a dirty-rect accumulator + count", () => {
    // Under UI_REQUIRES_BACKING_STORE the runtime accumulates paint rects per
    // frame and unions them into the refresh region at flush.
    expect(header).toMatch(/__ui_refresh_rects|ui_refresh_add_rect|UI_REFRESH_MAX_RECTS/);
  });

  it("issues a partial refresh of the union at flush", () => {
    expect(header).toMatch(/ui_refresh_flush|display_partial_refresh/);
  });

  it("references UI_REQUIRES_BACKING_STORE (the activation guard)", () => {
    expect(header).toMatch(/UI_REQUIRES_BACKING_STORE/);
  });

  it("TFT path compiles the refresh calls to no-op stubs", () => {
    // The #ifndef UI_REQUIRES_BACKING_STORE branch defines no-op macros so TFT
    // call sites compile cleanly without the scheduler.
    expect(header).toMatch(/#define ui_refresh_add_rect|#ifndef UI_REQUIRES_BACKING_STORE/);
  });
});
