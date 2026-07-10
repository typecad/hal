// ---------------------------------------------------------------------------
// @typecad/ui — runtime throw-contract tests
//
// The package is a compile-time construct: the cuttlefish transpiler lowers
// every ui.* call at build time. The runtime fallback must throw a clear
// "compile-time construct" error if a method ever runs in plain Node (a
// forgotten build step), rather than silently no-op. This file exhaustively
// verifies that contract for every documented method — not just mount.
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { ui } from "@typecad/ui";

// Invoking each method with the fewest/most representative args that satisfy
// its declared signature. The body never runs (it throws before using them).
const callCases = [
  { name: "mount", fn: () => ui.mount(undefined) },
  { name: "signal", fn: () => ui.signal(0) },
  { name: "bind", fn: () => ui.bind(undefined, "text", () => 0) },
  { name: "bindInput", fn: () => ui.bindInput(undefined, () => {}) },
  { name: "bindList", fn: () => ui.bindList(undefined, () => 0, () => "") },
  { name: "watchPin", fn: () => ui.watchPin(0, () => {}) },
  { name: "onTap", fn: () => ui.onTap() },
  { name: "drawCanvas", fn: () => ui.drawCanvas(undefined, () => {}) },
] as const;

describe("@typecad/ui runtime throw-contract", () => {
  it.each(callCases)(
    "$name throws a compile-time-construct error at runtime",
    ({ fn }) => {
      expect(fn).toThrow(/compile-time|transpiler/i);
    },
  );

  it("ui.window.setTitle and setIcon both throw compile-time errors", () => {
    expect(() => ui.window.setTitle("x")).toThrow(/compile-time|transpiler/i);
    expect(() => ui.window.setIcon("icon.png")).toThrow(/compile-time|transpiler/i);
  });

  it("every thrown error message identifies @typecad/ui", () => {
    // A loud failure is only useful if it points at the right package.
    for (const { fn } of callCases) {
      expect(() => fn()).toThrow(/@typecad\/ui/);
    }
    expect(() => ui.window.setTitle("x")).toThrow(/@typecad\/ui/);
    expect(() => ui.window.setIcon("icon.png")).toThrow(/@typecad\/ui/);
  });

  it("all ui.* methods share one throw closure (no silent no-op swaps)", () => {
    // The namespace is built from a single COMPILE_TIME_ERROR factory. If a
    // method were accidentally swapped for a no-op stub, this catches it:
    // toString() of the bound function must match across every method.
    const refs = [
      ui.mount, ui.signal, ui.bind, ui.bindInput, ui.bindList,
      ui.watchPin, ui.onTap, ui.drawCanvas,
    ].map((fn) => Function.prototype.toString.call(fn));
    const first = refs[0];
    expect(refs.every((src) => src === first)).toBe(true);
  });
});
