// ---------------------------------------------------------------------------
// NativeStrategy async provider — previously the native target emitted no
// async runtime at all, so any `async function` linked against missing
// __cuttlefish_async_* symbols. The polyfill must carry a __tc_now_ms() forward
// declaration because polyfill definitions emit before shimLines (where the
// native __tc_now_ms() shim is defined).
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { NativeStrategy } from "../../../../packages/cuttlefish/src/frameworks/native/strategy";

describe("NativeStrategy async runtime polyfill", () => {
  const s = new NativeStrategy();

  it("emits async_runtime for a program with an async function", () => {
    const program = { functions: [{ isAsync: true }] } as any;
    const irs = s.generateNativePolyfills(program);
    const asyncIr = irs.find((p) => p.id === "async_runtime");
    expect(asyncIr).toBeDefined();
    expect(asyncIr!.helperStructs[0]).toContain("typecad_async_static");
    expect(asyncIr!.forwardDeclarations).toContain("uint32_t __tc_now_ms(void);");
  });

  it("omits async_runtime when the program has no async functions", () => {
    const program = { functions: [{ isAsync: false }] } as any;
    const irs = s.generateNativePolyfills(program);
    expect(irs.map((p) => p.id)).not.toContain("async_runtime");
  });
});
