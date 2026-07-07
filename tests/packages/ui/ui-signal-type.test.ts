// ---------------------------------------------------------------------------
// Signal<T> type constraint tests
//
// Guards the fix that constrains Signal<T extends SignalValue> so unsupported
// initializers (objects, arrays, null) are rejected at type-check time. These
// are TYPE-LEVEL assertions validated by `tsc` (run via the root
// `npm run typecheck` / CI). Vitest's esbuild transform strips types without
// checking them, so the @ts-expect-error directives are enforced by tsc, not
// by the vitest runtime.
//
// To avoid invoking the throwing `ui.signal` stub at runtime, the type
// assertions use a deferred wrapper: a function whose BODY calls ui.signal,
// but which is never invoked. tsc still checks the body.
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { ui, type Signal, type SignalValue } from "@typecad/ui";

// ── Compile-time-only type assertions ─────────────────────────────────────
// The function bodies below are checked by tsc but never executed (the wrapper
// is never called). If the Signal<T extends SignalValue> constraint regresses,
// the @ts-expect-error directives become unused (the errors they expected no
// longer fire) and `tsc` fails with "Unused '@ts-expect-error' directive."

function _acceptedShapes() {
  // Overloads widen literals to their primitive: signal(0) → Signal<number>,
  // so .set(1) is allowed (not Signal<0> where .set(1) would fail).
  const _n: Signal<number> = ui.signal(42);
  const _s: Signal<string> = ui.signal("hello");
  const _b: Signal<boolean> = ui.signal(true);
  void _n; void _s; void _b;
}

function _rejectedShapes() {
  // @ts-expect-error — object literal not assignable to SignalValue
  const _o: Signal<{ x: number }> = ui.signal({ x: 1 });
  // @ts-expect-error — array literal not assignable to SignalValue
  const _a: Signal<number[]> = ui.signal([1, 2, 3]);
  // @ts-expect-error — null not assignable to SignalValue
  const _n: Signal<null> = ui.signal(null);
  void _o; void _a; void _n;
}

// Reference the wrappers so they're not tree-shaken from type-checking.
void _acceptedShapes;
void _rejectedShapes;

// ── Runtime sanity (no calls to the throwing stubs) ───────────────────────

describe("Signal<T extends SignalValue> type constraint", () => {
  it("SignalValue is exported as number | string | boolean", () => {
    const n: SignalValue = 1;
    const s: SignalValue = "x";
    const b: SignalValue = true;
    expect([n, s, b]).toHaveLength(3);
  });

  it("the ui namespace is still importable (no import-time regression)", () => {
    expect(typeof ui.signal).toBe("function");
    expect(typeof ui.mount).toBe("function");
  });
});
