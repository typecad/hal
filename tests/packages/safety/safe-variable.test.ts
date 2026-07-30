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
    expect(result.cpp).toContain("replicaValid");
    expect(result.cpp).toContain("replicaA_val");
  });

  it("does NOT emit SafeVariable template when the sketch doesn't use it", () => {
    // Polyfill emission is gated on programUsesSafety(program), which detects
    // SafeVariable/SafeInt usage via var_decl cppTypes. A sketch with no safety
    // usage must not leak the ~200-line polyfill (previously it did, which
    // tripped byte-identity / lowering assertions because SafeInt's `return
    // *this` chaining methods injected a `this` token into every sketch).
    const ts = `const x = 5;`;
    const result = transpile(ts);
    expect(result.cpp).not.toContain("struct SafeVariable");
    expect(result.cpp).not.toContain("struct SafeInt");
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
