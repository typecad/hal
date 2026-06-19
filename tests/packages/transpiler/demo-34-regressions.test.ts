import { describe, it, expect } from "vitest";
import { transpile } from "../../setup";

// ── D: inline ternary of two string literals as a `+` operand ───────────────
// A ternary whose two branches are string literals must infer `const char*`
// (what it renders as), NOT `std::string`, so the concat/snprintf path does
// not wrap it in an invalid `.c_str()`.
describe("D: inline ternary of string literals in concat", () => {
  it("compiles 'x=' + (cond ? 'a' : 'b') without an invalid .c_str()", () => {
    const src = `
function tag(on: boolean): string {
  return 'x=' + (on ? 'a' : 'b');
}
console.log(tag(true));
`;
    const res = transpile(src, { target: "arduino" });
    // The invalid form was `(on ? "a" : "b").c_str()`; it must not appear.
    expect(res.cpp).not.toMatch(/\)\.c_str\(\)/);
    // The ternary should render as a bare conditional, fed straight to snprintf.
    expect(res.cpp).toMatch(/\(on \? "a" : "b"\)/);
  });
});
