// ---------------------------------------------------------------------------
// @typecad/ui — authoring API surface tests
//
// These tests guard the public authoring surface of the @typecad/ui package:
// the `ui` namespace must be importable at runtime (it is a compile-time
// construct for the transpiler, but the module still has to load without
// crashing when a tool, test, or editor imports it from Node), and every
// method documented in the README must be present on the namespace.
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { ui } from "@typecad/ui";

describe("@typecad/ui authoring namespace", () => {
  it("is importable at runtime without throwing", async () => {
    // Importing the module already executed its top level. Re-import via the
    // dynamic path to assert the module evaluates cleanly.
    const mod = await import("@typecad/ui");
    expect(mod.default).toBe(ui);
    expect(mod.ui).toBe(ui);
  });

  it("exposes every documented authoring method", () => {
    // Every name listed here is referenced in the package README. Keeping
    // them asserted prevents the namespace and the docs from drifting again
    // (see the ui.bindInput regression — documented but previously missing).
    const documented = [
      "mount",
      "signal",
      "bind",
      "bindInput",
      "bindList",
      "watchPin",
      "onTap",
      "drawCanvas",
    ] as const;

    for (const name of documented) {
      expect(typeof (ui as Record<string, unknown>)[name]).toBe("function");
    }
  });

  it("throws a clear compile-time-construct error when mount is invoked at runtime", () => {
    // The transpiler lowers these calls; if one ever runs in plain TS/Node
    // (e.g. a forgotten build step), it must fail loudly, not silently no-op.
    expect(() => (ui as unknown as { mount: () => void }).mount(undefined))
      .toThrow(/compile-time|transpiler/i);
  });
});
