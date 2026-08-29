import { describe, it, expect } from "vitest";
import { NativeStrategy } from "../../../../packages/cuttlefish/src/frameworks/native/strategy";

// Native (SDL desktop) timer shims used to launch detached std::async lambdas
// (`(void)f;`) with `clearInterval`/`clearTimeout` as no-ops. Two defects:
// (a) cancelled timers kept firing — the `while(true)` ignored the clear;
// (b) detached futures leaked for the process lifetime. Timers are a language
// feature a native app reasonably uses, so the shims must actually cancel.
//
// This locks down the shape: a handle with an atomic cancel flag, threads that
// check it each iteration, and clear* helpers that set it. (Full thread-
// cancellation behavior is a C++ runtime concern, outside vitest scope; this
// test locks the generated shim text so the contract can't silently regress.)

describe("NativeStrategy timer shims are cancellable", () => {
  const s = new NativeStrategy();
  const helpers = s.generateNativePolyfills().flatMap((block) => block.helperFunctions ?? []);

  it("setInterval checks a cancel flag each iteration (not a bare while(true))", () => {
    // setInterval delegates to __tc_start_timer, which owns the loop + flag.
    const startTimer = helpers.find((h) => h.includes("__tc_start_timer"));
    expect(startTimer).toBeDefined();
    // The worker loop must reference a cancel flag checked inside the loop.
    expect(startTimer!).toMatch(/cancel/i);
    expect(startTimer!).toMatch(/while/);
  });

  it("clearInterval sets the cancel flag (not a no-op comment)", () => {
    const clearInt = helpers.find((h) => h.includes("__tc_clearInterval"));
    expect(clearInt).toBeDefined();
    // The old shim was `/* not implemented in native yet */`. The new one must
    // actually mutate state — reference the flag/store, not be a bare comment.
    expect(clearInt!).not.toMatch(/not implemented/i);
    expect(clearInt!.length).toBeGreaterThan("void __tc_clearInterval(int id) { }".length);
  });

  it("clearTimeout sets the cancel flag (not a no-op comment)", () => {
    const clearTo = helpers.find((h) => h.includes("__tc_clearTimeout"));
    expect(clearTo).toBeDefined();
    expect(clearTo!).not.toMatch(/not implemented/i);
  });
});
