import { describe, it, expect } from "vitest";
import { transpile } from "../../setup";

describe("SafeVariable polyfill", () => {
  it("emits the SafeVariable template struct when used", () => {
    const ts = `
let speed: SafeVariable<number> = 1000;
speed.set(2000);
let ok = false;
const current = speed.read(&ok);
if (ok) { console.log(current); }
`;
    const result = transpile(ts, { autosar: "warn" });
    expect(result.cpp).toContain("template <typename T>");
    expect(result.cpp).toContain("struct SafeVariable");
    expect(result.cpp).toContain("~static_cast<T>");
    expect(result.cpp).toContain("value ^ inverted");
  });

  it("always emits SafeVariable template when safety package is active", () => {
    // SafeVariable is a type annotation, not a call expression — the tree-shaker
    // can't detect it at IR time. The template is always emitted when
    // @typecad/safety is installed. It's a small definition and the safety
    // package is opt-in.
    const ts = `const x = 5;`;
    const result = transpile(ts);
    // The safety hook is registered in tests/setup-framework.ts, so the
    // polyfill is always available.
    expect(result.cpp).toContain("struct SafeVariable");
  });

  it("resolves SafeVariable<number> to SafeVariable<CppType> in emitted C++", () => {
    const ts = `
let speed: SafeVariable<number> = 1000;
console.log(speed);
`;
    const result = transpile(ts);
    expect(result.cpp).toMatch(/SafeVariable<(int|double)/);
  });

  it("lowers .set() as a method call on the template instance", () => {
    const ts = `
let speed: SafeVariable<number> = 1000;
speed.set(2000);
console.log(speed);
`;
    const result = transpile(ts);
    expect(result.cpp).toContain("speed.set(2000)");
  });
});
