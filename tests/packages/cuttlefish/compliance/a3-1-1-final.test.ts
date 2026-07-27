import { describe, it, expect } from "vitest";
import { transpile } from "../../../setup";

describe("A3-1-1: final on leaf classes", () => {
  it("stamps final on a class that nothing inherits from", () => {
    const ts = `class Leaf { x: number = 1; }`;
    const result = transpile(ts, { autosar: "strict" });
    expect(result.cpp).toMatch(/class\s+Leaf\s+final\s*\{/);
  });

  it("does NOT stamp final on a base class that another class extends", () => {
    const ts = `
class Base { x: number = 1; }
class Derived extends Base { y: number = 2; }
`;
    const result = transpile(ts, { autosar: "strict" });
    // Base is inherited from -> no final. Derived is a leaf -> final.
    // The class definition line for Base is `class Base {` (no final).
    expect(result.cpp).toMatch(/class\s+Base\s*\{[^_]/m);
    expect(result.cpp).not.toMatch(/class\s+Base[^{]*\bfinal\b/);
    // Derived has an inheritance clause, so final appears after `: public Base`.
    expect(result.cpp).toMatch(/class\s+Derived\s*:[^{]*\bfinal\s*\{/);
  });

  it("does not stamp final when autosar is off (default)", () => {
    const ts = `class Leaf { x: number = 1; }`;
    const result = transpile(ts);
    expect(result.cpp).not.toMatch(/class\s+Leaf\s+final/);
  });
});
