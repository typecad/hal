// ---------------------------------------------------------------------------
// Tests for CppTypeIR — the structured replacement for the stringly-typed
// `CppType = string` / `CppTypeHint` template-literal union.
//
// The core contract is a **byte-identical round trip**:
//     renderCppType(parseCppType(s)) === s
// for every C++ type string the transpiler actually emits. This is the safety
// net for the staged migration (Stages 1–3): as long as the round trip holds,
// the parser/renderer can be inserted anywhere along the producer→consumer
// chain without changing observable behavior.
//
// The corpus below was gathered by scanning `tests/` and
// `packages/cuttlefish/src/` for every `std::vector<…>`, `std::map<…>`,
// pointer, reference, fixed-width-int, and pseudo-type spelling that appears.
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import {
  parseCppType,
  renderCppType,
  splitTemplateArgs,
  isPointer,
  isVector,
  isMap,
  isContainer,
  isStringLike,
  isPrimitive,
  bareType,
  elementOf,
  formatKindOf,
  CppTypeIR,
} from "../../../packages/cuttlefish/src/api/shared/cpp-type-ir";

// ---------------------------------------------------------------------------
// Round-trip corpus
// ---------------------------------------------------------------------------

const ROUND_TRIP_CASES: string[] = [
  // ── primitives ───────────────────────────────────────────────────────────
  "int", "long", "long long", "unsigned int", "unsigned long long",
  "float", "double", "bool", "void", "char",
  "size_t", "int8_t", "int16_t", "int32_t", "int64_t",
  "uint8_t", "uint16_t", "uint32_t", "uint64_t",

  // ── std::string / auto ───────────────────────────────────────────────────
  "std::string", "auto",

  // ── const / pointer / reference combinations ────────────────────────────
  "const char*",                 // pointer(const char) — peels pointer, not const
  "const std::string",           // qualified(const, string)
  "const int",                   // qualified(const, int)
  "const Task&",                 // reference(const Task)
  "const std::vector<int>&",     // reference(qualified(const, vector<int>))
  "const std::string&",
  "const void*",
  "const double&",
  "const int16_t&",
  "const iterator&",

  // ── class pointers (the producer always suffixes user classes with *) ────
  "Animal*", "Config*", "Engine*", "GameState*", "Player*", "Sensor*",
  "HardwareSerial*", "SPIClass*", "TwoWire*", "SHT3x*", "SHT3x&",
  "std::shared_ptr<Foo>", "std::unique_ptr<Foo>",

  // ── std::vector<T> ───────────────────────────────────────────────────────
  "std::vector<int>",
  "std::vector<double>",
  "std::vector<std::string>",
  "std::vector<bool>",
  "std::vector<T>",                       // template-param element
  "std::vector<Item*>",                   // pointer element
  "std::vector<Point>",
  "std::vector<Microtask>",

  // ── std::map<K,V> / std::set<T> ──────────────────────────────────────────
  "std::map<std::string, int32_t>",
  "std::map<std::string, double>",
  "std::map<double, std::string>",
  "std::set<double>",

  // ── std::tuple / std::variant ────────────────────────────────────────────
  "std::tuple<A, B, C>",
  "std::variant<double, std::string>",
  "std::variant<_Event_Variant_0, _Event_Variant_1>",

  // ── std::function<R(P...)> ───────────────────────────────────────────────
  "std::function<void()>",
  "std::function<void(const T&)>",
  "std::function<void(const std::string&)>",
  "std::function<void(const void*)>",
  "std::function<R(args)>",

  // ── pseudo-types ─────────────────────────────────────────────────────────
  "__tc_StaticArray<int, 4>",
  "__tc_StaticArray<int, 5>",
  "__tc_str_ptr",
];

describe("parseCppType / renderCppType round trip", () => {
  for (const s of ROUND_TRIP_CASES) {
    it(`round-trips: ${s}`, () => {
      const rendered = renderCppType(parseCppType(s));
      expect(rendered).toBe(s);
    });
  }
});

// ---------------------------------------------------------------------------
// Structural assertions — prove the parser produces the expected discriminated
// shape (not just that it round-trips).
// ---------------------------------------------------------------------------

describe("parseCppType structural shape", () => {
  it("parses primitives", () => {
    expect(parseCppType("int")).toEqual({ kind: "primitive", name: "int" });
    expect(parseCppType("uint32_t")).toEqual({ kind: "primitive", name: "uint32_t" });
    expect(parseCppType("void")).toEqual({ kind: "primitive", name: "void" });
  });

  it("parses std::string and auto as distinct kinds", () => {
    expect(parseCppType("std::string")).toEqual({ kind: "string" });
    expect(parseCppType("auto")).toEqual({ kind: "auto" });
  });

  it("parses vectors with an element child", () => {
    expect(parseCppType("std::vector<int>")).toEqual({
      kind: "vector", element: { kind: "primitive", name: "int" },
    });
    expect(parseCppType("std::vector<std::string>")).toEqual({
      kind: "vector", element: { kind: "string" },
    });
    expect(parseCppType("std::vector<Item*>")).toEqual({
      kind: "vector", element: { kind: "pointer", base: { kind: "named", name: "Item" } },
    });
  });

  it("parses maps with two children", () => {
    expect(parseCppType("std::map<std::string, int32_t>")).toEqual({
      kind: "map",
      key: { kind: "string" },
      value: { kind: "primitive", name: "int32_t" },
    });
  });

  it("parses class pointers", () => {
    expect(parseCppType("Animal*")).toEqual({
      kind: "pointer", base: { kind: "named", name: "Animal" },
    });
  });

  it("parses const char* as pointer-to-qualified-char (NOT qualified-to-pointer)", () => {
    // Critical: `const char*` means "pointer to const char", not "const pointer to char".
    const ir = parseCppType("const char*");
    expect(ir.kind).toBe("pointer");
    expect(ir).toMatchObject({
      kind: "pointer",
      base: { kind: "qualified", isConst: true, base: { kind: "primitive", name: "char" } },
    });
  });

  it("parses top-level const prefix as qualified wrapper", () => {
    expect(parseCppType("const std::string")).toEqual({
      kind: "qualified", isConst: true, base: { kind: "string" },
    });
  });

  it("parses references, propagating isConst", () => {
    const ir = parseCppType("const Task&");
    expect(ir.kind).toBe("reference");
    if (ir.kind === "reference") {
      expect(ir.isConst).toBe(true);
      expect(ir.base).toMatchObject({ kind: "qualified", base: { kind: "named", name: "Task" } });
    }
  });

  it("parses std::function<void(const T&)>", () => {
    const ir = parseCppType("std::function<void(const T&)>");
    expect(ir.kind).toBe("function");
    if (ir.kind === "function") {
      expect(ir.params).toHaveLength(1);
      expect(ir.params[0]).toMatchObject({ kind: "reference", isConst: true });
    }
  });

  it("parses __tc_StaticArray<int, 4> with a concrete size", () => {
    expect(parseCppType("__tc_StaticArray<int, 4>")).toEqual({
      kind: "staticArray", element: { kind: "primitive", name: "int" }, size: 4,
    });
  });

  it("parses __tc_str_ptr", () => {
    expect(parseCppType("__tc_str_ptr")).toEqual({ kind: "strPtr" });
  });

  it("preserves unknown spellings via the opaque escape hatch", () => {
    const ir = parseCppType("some/weird spelling");
    expect(ir.kind).toBe("opaque");
    expect(renderCppType(ir)).toBe("some/weird spelling");
  });
});

// ---------------------------------------------------------------------------
// splitTemplateArgs — the promoted, correct nested-template splitter.
// ---------------------------------------------------------------------------

describe("splitTemplateArgs", () => {
  it("splits top-level commas", () => {
    expect(splitTemplateArgs("int, double")).toEqual(["int", " double"]);
  });

  it("does not split on commas inside nested templates", () => {
    expect(splitTemplateArgs("int, std::map<K, V>")).toEqual(["int", " std::map<K, V>"]);
  });

  it("handles deep nesting", () => {
    expect(splitTemplateArgs("std::vector<std::map<K, V>>, int")).toEqual([
      "std::vector<std::map<K, V>>", " int",
    ]);
  });
});

// ---------------------------------------------------------------------------
// Predicate helpers — the things that replace inline `endsWith("*")` etc.
// ---------------------------------------------------------------------------

describe("predicates", () => {
  it("isPointer", () => {
    expect(isPointer(parseCppType("Animal*"))).toBe(true);
    expect(isPointer(parseCppType("int"))).toBe(false);
    expect(isPointer(parseCppType("const char*"))).toBe(true);
  });

  it("isVector / isMap / isContainer", () => {
    expect(isVector(parseCppType("std::vector<int>"))).toBe(true);
    expect(isMap(parseCppType("std::map<int, int>"))).toBe(true);
    expect(isContainer(parseCppType("std::vector<int>"))).toBe(true);
    expect(isContainer(parseCppType("std::set<int>"))).toBe(true);
    expect(isContainer(parseCppType("int"))).toBe(false);
  });

  it("isStringLike detects std::string and __tc_str_ptr", () => {
    expect(isStringLike(parseCppType("std::string"))).toBe(true);
    expect(isStringLike(parseCppType("__tc_str_ptr"))).toBe(true);
    expect(isStringLike(parseCppType("int"))).toBe(false);
  });

  it("isPrimitive peels const", () => {
    expect(isPrimitive(parseCppType("int"))).toBe(true);
    expect(isPrimitive(parseCppType("const int"))).toBe(true);
    expect(isPrimitive(parseCppType("std::string"))).toBe(false);
  });

  it("bareType strips pointer/reference/const", () => {
    expect(bareType(parseCppType("const Foo*"))).toEqual({ kind: "named", name: "Foo" });
    expect(bareType(parseCppType("const std::vector<int>&"))).toEqual({
      kind: "vector", element: { kind: "primitive", name: "int" },
    });
  });

  it("elementOf extracts the element/value type", () => {
    expect(elementOf(parseCppType("std::vector<double>"))).toEqual({ kind: "primitive", name: "double" });
    expect(elementOf(parseCppType("std::map<std::string, int>"))).toEqual({ kind: "primitive", name: "int" });
    expect(elementOf(parseCppType("int"))).toBeUndefined();
  });

  it("formatKindOf buckets for snprintf dispatch", () => {
    expect(formatKindOf(parseCppType("int"))).toBe("int");
    expect(formatKindOf(parseCppType("uint8_t"))).toBe("uint");
    expect(formatKindOf(parseCppType("long long"))).toBe("ulong");
    expect(formatKindOf(parseCppType("double"))).toBe("float");
    expect(formatKindOf(parseCppType("bool"))).toBe("bool");
    expect(formatKindOf(parseCppType("std::string"))).toBe("string");
    expect(formatKindOf(parseCppType("const char*"))).toBe("string");
    expect(formatKindOf(parseCppType("Foo*"))).toBe("pointer");
  });
});

// ---------------------------------------------------------------------------
// Builder helpers — round-trip parity with parsing.
// ---------------------------------------------------------------------------

describe("CppTypeIR builders", () => {
  it("builds and renders a vector of pointers", () => {
    const ir = CppTypeIR.vector(CppTypeIR.pointer(CppTypeIR.named("Item")));
    expect(renderCppType(ir)).toBe("std::vector<Item*>");
  });

  it("builds and renders a const ref to a map", () => {
    const ir = CppTypeIR.reference(
      CppTypeIR.const_(CppTypeIR.map(CppTypeIR.string(), CppTypeIR.int())),
      true,
    );
    expect(renderCppType(ir)).toBe("const std::map<std::string, int>&");
  });

  it("builds and renders std::function<void()>", () => {
    const ir = CppTypeIR.function(CppTypeIR.void(), []);
    expect(renderCppType(ir)).toBe("std::function<void()>");
  });

  it("builder output is parseable to the same shape", () => {
    const ir = CppTypeIR.variant([CppTypeIR.double(), CppTypeIR.string()]);
    const roundTrip = parseCppType(renderCppType(ir));
    expect(roundTrip).toEqual(ir);
  });
});
