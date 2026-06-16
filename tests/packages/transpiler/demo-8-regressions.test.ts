// ---------------------------------------------------------------------------
// Regression tests for transpiler gaps surfaced by Demo #8 (Strata config).
//
// Fixes covered:
//   A — `extends Generic<T>` now resolves the heritage type arguments
//       (was: dropped, leaving the base as an unsubstituted template)
//
// Documented (not yet fixed) — see README:
//   B — static getter/setter on a class emits `Cls::getName() cannot have cv-qualifier`
//   C — `new Generic<T>()` constructor call resolves type args via getText (TS names)
//   D — `m.delete(k)` on a Map-typed param emits `m.delete_` (keyword escape on method)
//   E — object-literal locals with the same shape collide on shadow-struct names
//   F — tuple type alias `type P = [K, V]` is dropped at emit
//   G — interface-with-index-signature object literal can't brace-init the std::map
//   H — `Map.size` property access emits `map->size` (pointer deref on a non-pointer)
//   I — `??=` and array-destructure-default produce wrong runtime values
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { transpile } from "../../setup";

function transpileNativeSplit(tsCode: string) {
  return transpile(tsCode, { target: "native", emitMode: "split" });
}

// ---------------------------------------------------------------------------
// A: generic subclass heritage type arguments
// ---------------------------------------------------------------------------
describe("A: generic subclass heritage type args", () => {
  it("extends Registry<string, number> emits : public Registry<std::string, double>", () => {
    const result = transpileNativeSplit(
      [
        "export class Registry<K extends string | number | symbol, V> {",
        "  entries: Record<K, V>;",
        "  constructor(initial: Record<K, V>) { this.entries = initial; }",
        "}",
        "export class StringRegistry extends Registry<string, number> {",
        "  tag: string;",
        "  constructor(initial: Record<string, number>, tag: string) {",
        "    super(initial);",
        "    this.tag = tag;",
        "  }",
        "}",
        "",
      ].join("\n"),
    );
    const all = (result.header ?? "") + "\n" + (result.cpp ?? "");
    // The subclass must reference the substituted template base, not the bare
    // unsubstituted name.
    expect(all).toMatch(/public\s+Registry<std::string,\s*double>/);
  });

  it("extends Base (no type args) still emits the bare base name", () => {
    const result = transpileNativeSplit(
      [
        "export class Base { x: int32_t; constructor() { this.x = 0; } }",
        "export class Derived extends Base { y: int32_t; constructor() { super(); this.y = 1; } }",
        "",
      ].join("\n"),
    );
    const all = (result.header ?? "") + "\n" + (result.cpp ?? "");
    expect(all).toMatch(/public\s+Base\b/);
    expect(all).not.toMatch(/public\s+Base</);
  });
});

// ---------------------------------------------------------------------------
// B: static getter/setter has no cv-qualifier
// ---------------------------------------------------------------------------
describe("B: static getter cv-qualifier", () => {
  it("static get emits without the 'const' cv-qualifier", () => {
    const result = transpileNativeSplit(
      [
        "export class C {",
        "  static created: int32_t = 0;",
        "  static get count(): int32_t { return C.created; }",
        "}",
        "",
      ].join("\n"),
    );
    const all = (result.header ?? "") + "\n" + (result.cpp ?? "");
    // A static getter must NOT carry `() const` (illegal on static members).
    expect(all).toMatch(/static\s+int32_t\s+\w+\(\)\s*\{/);
    expect(all).not.toMatch(/static\s+int32_t\s+\w+\(\)\s*const/);
  });
});

// ---------------------------------------------------------------------------
// D: m.delete(k) on a Map-typed param lowers to .erase (not delete_)
// ---------------------------------------------------------------------------
describe("D: Map.delete on a param", () => {
  it("m.delete(k) emits m.erase(k), not m.delete_(k)", () => {
    const result = transpileNativeSplit(
      [
        "export function f(m: Map<string, int32_t>, k: string): boolean {",
        "  return m.delete(k);",
        "}",
        "",
      ].join("\n"),
    );
    const cpp = result.cpp ?? "";
    expect(cpp).toMatch(/\.erase\(/);
    expect(cpp).not.toContain("delete_");
  });
});

// ---------------------------------------------------------------------------
// F: tuple/container type alias is emitted as `using`
// ---------------------------------------------------------------------------
describe("F: tuple type alias emitted", () => {
  it("type Pair = [string, int32_t] emits a `using` directive", () => {
    const result = transpileNativeSplit(
      [
        "export type Pair = [string, int32_t];",
        "export function f(): Pair { return ['a', 1]; }",
        "",
      ].join("\n"),
    );
    expect(result.header ?? "").toMatch(/using\s+Pair\s*=/);
  });
});

// ---------------------------------------------------------------------------
// H: Map.size lowers to .size() (not ->size)
// ---------------------------------------------------------------------------
describe("H: Map.size method call", () => {
  it("dm.size emits dm.size(), not dm->size", () => {
    const result = transpileNativeSplit(
      [
        "export function f(dm: Map<string, int32_t>): int32_t {",
        "  return dm.size;",
        "}",
        "",
      ].join("\n"),
    );
    const cpp = result.cpp ?? "";
    expect(cpp).toMatch(/\.size\(\)/);
    expect(cpp).not.toMatch(/->size/);
  });
});

// ---------------------------------------------------------------------------
// I: ??= on a property-access left side
// ---------------------------------------------------------------------------
describe("I: ??= on property access", () => {
  it("obj.val ??= 42 emits a nullish-guarded assignment", () => {
    const result = transpileNativeSplit(
      [
        "export interface O { val?: int32_t; }",
        "export function f(o: O): void {",
        "  let local: O = { val: o.val ?? 0 };",
        "  local.val ??= 42;",
        "}",
        "",
      ].join("\n"),
    );
    const cpp = result.cpp ?? "";
    expect(cpp).toContain("cuttlefish_is_nullish");
    expect(cpp).toMatch(/local\.val\s*=/);
  });
});
