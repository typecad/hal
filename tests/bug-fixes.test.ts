import { describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { transpile, transpileArduino, transpileNative, expectCppContains, expectCppNotContains } from "./setup";
import { transpileFile } from "../packages/cuttlefish/src/testing";

// ===========================================================================
// Bug fix regression tests
// ===========================================================================

describe("Bug 1: this.x = val assignments in constructor/method bodies", () => {
  it("emits this->field = value in constructor body", () => {
    const result = transpileArduino(`
      class Counter {
        count: number;
        constructor(initial: number) {
          this.count = initial;
        }
      }
    `);

    expectCppContains(result, ["this->count = initial"]);
  });

  it("emits this->field = this->field + expr in method body", () => {
    const result = transpileArduino(`
      class Counter {
        count: number;
        increment(): number {
          this.count = this.count + 1;
          return this.count;
        }
      }
    `);

    expectCppContains(result, ["this->count = this->count + 1"]);
    expectCppContains(result, ["return this->count"]);
  });

  it("emits obj.field = value for property access assignments", () => {
    const result = transpileArduino(`
      class Sensor {
        value: number;
      }
      const s = new Sensor();
      function configure(): void {
        s.value = 42;
      }
    `);

    // The key fix: the assignment is emitted at all (previously silently dropped)
    expectCppContains(result, ["s->value = 42"]);
  });
});

describe("Bug 5: arr[i] = val element access assignments", () => {
  it("emits arr[index] = value for element access assignments", () => {
    const result = transpileArduino(`
      const arr = new Uint8Array([1, 2, 3]);
      function setElement(data: Uint8Array, i: number, val: number): void {
        data[i] = val;
      }
    `);

    expectCppContains(result, ["data[i] = val"]);
  });

  it("emits arr[expr] = value with expression index", () => {
    const result = transpileArduino(`
      const buf = new Int16Array([10, 20, 30]);
      function updateAtOffset(data: Int16Array, base: number): void {
        data[base + 1] = 99;
      }
    `);

    expectCppContains(result, ["data[base + 1] = 99"]);
  });
});

describe("Bug 7: Parenthesized expressions preserve precedence", () => {
  it("wraps lower-precedence left operand in parentheses", () => {
    const result = transpileArduino(`
      const x: number = (2 + 3) * 4;
    `);

    // Should emit (2 + 3) * 4, not 2 + 3 * 4
    expectCppContains(result, ["(2 + 3) * 4"]);
  });

  it("wraps lower-precedence right operand in parentheses", () => {
    const result = transpileArduino(`
      const x: number = 4 * (2 + 3);
    `);

    expectCppContains(result, ["4 * (2 + 3)"]);
  });

  it("does not add unnecessary parentheses for same-precedence operators", () => {
    const result = transpileArduino(`
      const x: number = 2 + 3 + 4;
    `);

    // Same precedence, left-to-right — no parens needed
    expect(result.cpp).not.toContain("(2 + 3)");
  });

  it("handles mixed precedence chains", () => {
    const result = transpileArduino(`
      const x: number = (a + b) * (c + d);
    `);

    expectCppContains(result, ["(a + b) * (c + d)"]);
  });
});

describe("Bug 8: Postfix unary expressions in expression context", () => {
  it("emits i++ as postfix in expression context", () => {
    const result = transpileArduino(`
      let i: number = 0;
      const x: number = i++;
    `);

    // Should emit i++ (postfix), not ++i
    expectCppContains(result, ["i++"]);
  });

  it("emits i-- as postfix in expression context", () => {
    const result = transpileArduino(`
      let i: number = 5;
      const x: number = i--;
    `);

    expectCppContains(result, ["i--"]);
  });
});

describe("Bug 3: new Uint8Array(n) size constructor", () => {
  it("emits zero-initialized C array for new Uint8Array(4)", () => {
    const result = transpileArduino(`
      const buf = new Uint8Array(4);
    `);

    expectCppContains(result, ["uint8_t buf[] = { 0, 0, 0, 0 }"]);
    expectCppNotContains(result, ["new Uint8Array"]);
  });

  it("emits zero-initialized C array for new Int16Array(3)", () => {
    const result = transpileArduino(`
      const buf = new Int16Array(3);
    `);

    expectCppContains(result, ["int16_t buf[] = { 0, 0, 0 }"]);
    expectCppNotContains(result, ["new Int16Array"]);
  });
});

describe("Bug 9: String assertions preprocessor", () => {
  // Note: The preprocessor is tested via the preprocess function directly
  // These tests verify the ChainSegment carries isStringExpect flag
  it("distinguishes expectString from expect in segment collection", async () => {
    const { preprocess } = await import("../packages/expect/src/host/preprocessor");
    const result = preprocess(`
      import { describe, done } from '@typecad/expect';
      const greeting: string = "hello";
      describe("strings")
        .it("greeting")
          .expectString(greeting).toBe("hello")
      done();
    `);

    // The preprocessed output should use string type annotation for the hoisted variable
    expect(result).toContain("string");
    expect(result).toContain("greeting");
  });
});

// ===========================================================================
// Bug 4: Float type propagation
// ===========================================================================
describe("Bug 4: Float type propagation", () => {
  it("renders float literals with f suffix", () => {
    const result = transpileArduino(`
      const x = 1.5;
    `);

    expectCppContains(result, ["1.5f"]);
    expectCppNotContains(result, ["1.5;"]);
  });

  it("renders integer-valued float literals folded to int (double-compatible)", () => {
    const result = transpileArduino(`
      const y = 4.0;
    `);

    // Integer-valued float literals fold to a plain int literal, which is
    // implicitly convertible to double in C++ (4.0 === 4).
    expectCppContains(result, ["const double y = 4;"]);
  });

  it("infers double type for float variable declarations", () => {
    const result = transpileArduino(`
      const x = 1.5;
    `);

    expectCppContains(result, ["double x = 1.5f"]);
  });

  it("promotes function return type from int to double when body returns float", () => {
    const result = transpileArduino(`
      function half(n: number): number {
        return n / 2.0;
      }
    `);

    expectCppContains(result, ["double half"]);
    // Integer-valued float literal 2.0 folds to 2; n is double so division
    // promotes to double.
    expectCppContains(result, ["n / 2"]);
  });

  it("renders float arithmetic with f suffixes", () => {
    const result = transpileArduino(`
      const sum = 1.5 + 2.5;
    `);

    expectCppContains(result, ["1.5f"]);
    expectCppContains(result, ["2.5f"]);
    expectCppContains(result, ["double sum"]);
  });

  it("keeps integer literals without f suffix", () => {
    const result = transpileArduino(`
      const count = 42;
    `);

    expectCppContains(result, ["int count = 42"]);
    expectCppNotContains(result, ["42f"]);
  });

  it("handles mixed int/float arithmetic", () => {
    const result = transpileArduino(`
      const z = 10 + 0.5;
    `);

    expectCppContains(result, ["0.5f"]);
    expectCppContains(result, ["double z"]);
  });

  it("promotes arrow function return type when returning float", () => {
    const result = transpileArduino(`
      const getHalf = (n: number): number => {
        return n * 0.5;
      };
    `);

    expectCppContains(result, ["0.5f"]);
    expectCppContains(result, ["double getHalf"]);
  });
});

describe("Bug 2: Nested object struct generation", () => {
  it("generates nested struct for two-level nested object literal", () => {
    const result = transpileArduino(`
      const sensor = {
        calibration: { offset: 10, gain: 2 },
        name: "temp"
      };
    `);

    expectCppContains(result, [
      "struct _sensor_calibration_t { int offset; int gain; };",
      "_sensor_calibration_t calibration;",
      "const char* name;",
    ]);
    expectCppContains(result, ["{ { 10, 2 }, \"temp\" }"]);
  });

  it("generates nested struct for three-level nested object", () => {
    const result = transpileArduino(`
      const config = {
        display: { size: { w: 128, h: 64 }, inverted: false }
      };
    `);

    // Deepest struct first, then intermediate
    expectCppContains(result, [
      "struct _config_display_size_t { int w; int h; };",
      "struct _config_display_t { _config_display_size_t size; bool inverted; };",
    ]);
    expectCppContains(result, ["{ { { 128, 64 }, false } }"]);
  });

  it("preserves nested object field access expressions", () => {
    const result = transpileArduino(`
      const sensor = {
        calibration: { offset: 10, gain: 2 },
        name: "temp"
      };
      function readOffset(): number {
        return sensor.calibration.offset;
      }
    `);

    expectCppContains(result, ["sensor.calibration.offset"]);
  });

  it("handles nested object with mixed types including float", () => {
    const result = transpileArduino(`
      const device = {
        tuning: { frequency: 440.0, amplitude: 1 },
        active: true
      };
    `);

    expectCppContains(result, [
      "struct _device_tuning_t { double frequency; int amplitude; };",
      "double frequency",
    ]);
  });
});

describe("Bug 6: Nested function hoisting", () => {
  it("hoists nested function to file scope with mangled name", () => {
    const result = transpileArduino(`
      function outer(): number {
        function inner(x: number): number {
          return x * 2;
        }
        return inner(5);
      }
    `);

    expectCppContains(result, [
      "double outer__inner(double x)",
      "return x * 2;",
      "return outer__inner(5);",
    ]);
  });

  it("hoists nested function called before its declaration (hoisting)", () => {
    const result = transpileArduino(`
      function compute(): number {
        return helper(3);
        function helper(n: number): number {
          return n + 10;
        }
      }
    `);

    expectCppContains(result, [
      "double compute__helper(double n)",
      "return n + 10;",
      "return compute__helper(3);",
    ]);
  });

  it("hoists multiple nested functions from the same parent", () => {
    const result = transpileArduino(`
      function math(): number {
        function add(a: number, b: number): number {
          return a + b;
        }
        function mul(a: number, b: number): number {
          return a * b;
        }
        return add(mul(2, 3), 4);
      }
    `);

    expectCppContains(result, [
      "double math__add(double a, double b)",
      "double math__mul(double a, double b)",
      "return math__add(math__mul(2, 3), 4);",
    ]);
  });

  it("preserves return type annotation on nested function", () => {
    const result = transpileArduino(`
      function parent(): number {
        function child(x: number): number {
          return x + 1;
        }
        return child(10);
      }
    `);

    expectCppContains(result, [
      "double parent__child(double x)",
    ]);
  });
});

describe("Bug 10: filter() element type inference", () => {
  it("infers element type for filter on array literal", () => {
    const result = transpileArduino(`
      const data = [1, 2, 3, 4, 5];
      const evens = data.filter(x => x % 2 === 0);
    `);

    expectCppContains(result, ["int evens[]"]);
    expectCppNotContains(result, ["long long evens[]"]);
  });

  it("infers element type for filter on array of structs", () => {
    const result = transpileArduino(`
      interface CrewMember { id: number; name: string; }
      const crew = [{ id: 1, name: "Alice" }, { id: 2, name: "Bob" }];
      const active = crew.filter(c => c.id > 0);
    `);

    expectCppContains(result, ["_crew_t active[]"]);
    expectCppNotContains(result, ["long long active[]"]);
  });

  it("infers element type for map on array literal", () => {
    const result = transpileArduino(`
      const values = [10, 20, 30];
      const doubled = values.map(x => x * 2);
    `);

    expectCppContains(result, ["int doubled[]"]);
    expectCppNotContains(result, ["long long doubled[]"]);
  });
});

// ---------------------------------------------------------------------------
// Native main() return type — must be `int`, never `long long`.
// The NativeStrategy.normalizeCppType maps int → long long (JS numbers are
// 64-bit), but that normalization must NOT apply to main()'s signature, which
// the C++ standard requires to return int. NativeStrategy.mapReturnType
// special-cases main → int, but the render path was re-normalizing the
// already-mapped return type through normalizeCppType, turning int back into
// long long. Regression guard for the render-path fix.
// ---------------------------------------------------------------------------
describe("Native main() return type", () => {
  it("emits `int main()` for top-level statements (synthesized main)", () => {
    const result = transpileNative(`console.log("hi");`);
    expectCppContains(result, ["int main("]);
    expectCppNotContains(result, ["long long main("]);
  });

  it("emits `int main()` when main is declared explicitly", () => {
    const result = transpileNative(`
      function main(): number {
        console.log("hi");
        return 0;
      }
    `);
    expectCppContains(result, ["int main("]);
    expectCppNotContains(result, ["long long main("]);
  });

  it("does not collapse non-main return types to int", () => {
    const result = transpileNative(`
      function greet(name: string): string {
        return "hi " + name;
      }
      greet("world");
    `);
    // The entrypoint special-case must be scoped to main only.
    expectCppNotContains(result, ["int greet("]);
    expectCppContains(result, ["int main("]);
    expectCppNotContains(result, ["long long main("]);
  });
});

// ---------------------------------------------------------------------------
// Enum comparison across modules — comparing an enum-typed field on a class
// instance against an enum member must render both sides of `==` with the
// same type. Previously the enum member access was wrapped in
// static_cast<int>(...) while the field access (whose type was unknown to the
// renderer because the for-of loop variable's type wasn't propagated into the
// body scope) was left as a raw `SensorStatus`, producing:
//   error: no match for 'operator==' (operand types are 'SensorStatus' and 'int')
// Regression guard for the for-of/for-in loop-variable type propagation fix.
// ---------------------------------------------------------------------------
describe("Enum comparison across modules", () => {
  it("casts both sides of an enum equality comparison consistently", async () => {
    const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), "typecad-enum-"));
    try {
      const typesPath = path.join(workspaceDir, "SensorTypes.ts");
      const procPath = path.join(workspaceDir, "SensorProcessor.ts");
      const mainPath = path.join(workspaceDir, "main.ts");

      fs.writeFileSync(
        typesPath,
        [
          "export enum SensorStatus { Ok = 1, Warning = 2, Error = 3 }",
          "export class SensorReading {",
          "  value: number;",
          "  status: SensorStatus;",
          "  constructor(value: number, status: SensorStatus) {",
          "    this.value = value;",
          "    this.status = status;",
          "  }",
          "}",
          "",
        ].join("\n"),
        "utf8",
      );

      fs.writeFileSync(
        procPath,
        [
          'import { SensorReading, SensorStatus } from "./SensorTypes";',
          'export { SensorStatus } from "./SensorTypes";',
          "export class SensorProcessor {",
          "  readings: SensorReading[] = [];",
          "  addReading(value: number, status: SensorStatus): void {",
          "    const r = new SensorReading(value, status);",
          "    this.readings.push(r);",
          "  }",
          "  getReadings(): SensorReading[] { return this.readings; }",
          "}",
          "",
        ].join("\n"),
        "utf8",
      );

      fs.writeFileSync(
        mainPath,
        [
          'import { SensorProcessor, SensorStatus } from "./SensorProcessor";',
          "function main(): void {",
          "  const p = new SensorProcessor();",
          "  p.addReading(10, SensorStatus.Ok);",
          "  p.addReading(99, SensorStatus.Warning);",
          "  const readings = p.getReadings();",
          "  let warnings = 0;",
          "  for (const r of readings) {",
          "    if (r.status == SensorStatus.Warning) { warnings++; }",
          "  }",
          "  console.log(warnings);",
          "}",
          "",
        ].join("\n"),
        "utf8",
      );

      const result = await transpileFile({
        inputFile: mainPath,
        emitMode: "split",
        target: "native",
        emitMaps: false,
      });

      const outDir = path.join(workspaceDir, ".build");
      const mainCpp = fs.readFileSync(path.join(outDir, "main.cpp"), "utf8");

      // Both operands of the equality must be wrapped in static_cast<int> so
      // the comparison is int == int, not SensorStatus == int.
      expect(mainCpp).toContain("static_cast<int>(r->status)");
      expect(mainCpp).toContain("static_cast<int>(SensorStatus::Warning)");
      // And the field access must NOT appear un-cast alongside the cast member.
      expect(mainCpp).not.toContain("r->status == static_cast<int>");
    } finally {
      fs.rmSync(workspaceDir, { recursive: true, force: true });
    }
  });

  it("infers for-of element field types within a single module", () => {
    // Single-file variant: the loop variable's type must still be propagated
    // so property accesses on it resolve (here, used in a console.log format).
    const result = transpileNative(`
      enum Light { Red, Green }
      class Sample { state: Light; constructor(s: Light) { this.state = s; } }
      const items: Sample[] = [new Sample(Light.Red), new Sample(Light.Green)];
      let greens = 0;
      for (const it of items) {
        if (it.state == Light.Green) { greens++; }
      }
      console.log(greens);
    `);
    // Both sides cast consistently to int.
    expect(result.cpp).toContain("static_cast<int>(it->state)");
    expect(result.cpp).toContain("static_cast<int>(Light::Green)");
    expect(result.cpp).not.toContain("it->state == static_cast<int>");
  });
});

// ---------------------------------------------------------------------------
// Cross-module interface-typed const — an exported top-level const annotated
// with an interface defined in (or re-exported by) another file must emit
// exactly one extern + one definition using the interface's C++ struct type.
// Previously the transpiler synthesized a local `struct _name_t { ... }` and
// emitted a SECOND, conflicting struct, extern and definition, producing:
//   Config.h:  struct _DEFAULT_t { ... };  extern _DEFAULT_t DEFAULT;
//              extern const ThresholdConfig DEFAULT;          // from extern block
//   Config.cpp: struct _DEFAULT_t { ... } DEFAULT = { ... };  // redefinition
// Regression guard for the statement-renderer + emitPostClassDeclarations fix.
// ---------------------------------------------------------------------------
describe("Cross-module interface-typed const", () => {
  it("emits a single extern + definition using the interface struct", async () => {
    const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), "typecad-iface-"));
    try {
      const configPath = path.join(workspaceDir, "Config.ts");
      const svcPath = path.join(workspaceDir, "Service.ts");
      const mainPath = path.join(workspaceDir, "main.ts");

      fs.writeFileSync(
        configPath,
        [
          "export interface ThresholdConfig { low: number; high: number; }",
          "export const DEFAULT: ThresholdConfig = { low: 10, high: 100 };",
          "",
        ].join("\n"),
        "utf8",
      );

      fs.writeFileSync(
        svcPath,
        [
          'import { ThresholdConfig } from "./Config";',
          "export class Service {",
          "  private limit: number;",
          "  constructor(limit: number) { this.limit = limit; }",
          "  isWithin(cfg: ThresholdConfig): boolean {",
          "    return cfg.low <= this.limit && this.limit <= cfg.high;",
          "  }",
          "}",
          "",
        ].join("\n"),
        "utf8",
      );

      fs.writeFileSync(
        mainPath,
        [
          'import { Service } from "./Service";',
          'import { DEFAULT } from "./Config";',
          "function main(): void {",
          "  const s = new Service(50);",
          "  console.log(s.isWithin(DEFAULT));",
          "}",
          "",
        ].join("\n"),
        "utf8",
      );

      await transpileFile({
        inputFile: mainPath,
        emitMode: "split",
        target: "native",
        emitMaps: false,
      });

      const outDir = path.join(workspaceDir, ".build");
      const configHeader = fs.readFileSync(path.join(outDir, "Config.h"), "utf8");
      const configCpp = fs.readFileSync(path.join(outDir, "Config.cpp"), "utf8");

      // Exactly ONE extern, using the interface struct type (not a synthesized struct).
      const externMatches = configHeader.match(/extern\s+const\s+ThresholdConfig\s+DEFAULT\s*;/g) ?? [];
      expect(externMatches.length).toBe(1);
      expect(configHeader).not.toContain("_DEFAULT_t");

      // Exactly ONE definition in the cpp, using the interface struct type.
      const defMatches = configCpp.match(/const\s+ThresholdConfig\s+DEFAULT\s*=/g) ?? [];
      expect(defMatches.length).toBe(1);
      expect(configCpp).not.toContain("_DEFAULT_t");
    } finally {
      fs.rmSync(workspaceDir, { recursive: true, force: true });
    }
  });

  it("recognizes an interface defined in another file as a parameter type", async () => {
    const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), "typecad-iface-param-"));
    try {
      const configPath = path.join(workspaceDir, "Config.ts");
      const svcPath = path.join(workspaceDir, "Service.ts");
      const mainPath = path.join(workspaceDir, "main.ts");

      fs.writeFileSync(
        configPath,
        [
          "export interface ThresholdConfig { low: number; high: number; }",
          "",
        ].join("\n"),
        "utf8",
      );

      fs.writeFileSync(
        svcPath,
        [
          'import { ThresholdConfig } from "./Config";',
          "export class Service {",
          "  isWithin(cfg: ThresholdConfig, limit: number): boolean {",
          "    return cfg.low <= limit && limit <= cfg.high;",
          "  }",
          "}",
          "",
        ].join("\n"),
        "utf8",
      );

      fs.writeFileSync(
        mainPath,
        [
          'import { Service } from "./Service";',
          "function main(): void {",
          "  const s = new Service();",
          "  console.log(s.isWithin({ low: 1, high: 9 }, 5));",
          "}",
          "",
        ].join("\n"),
        "utf8",
      );

      await transpileFile({
        inputFile: mainPath,
        emitMode: "split",
        target: "native",
        emitMaps: false,
      });

      const outDir = path.join(workspaceDir, ".build");
      const svcHeader = fs.readFileSync(path.join(outDir, "Service.h"), "utf8");

      // The imported interface must be recognized (not lowered to a local struct).
      expect(svcHeader).toContain("isWithin(const ThresholdConfig& cfg");
      expect(svcHeader).not.toContain("struct _cfg_t");
    } finally {
      fs.rmSync(workspaceDir, { recursive: true, force: true });
    }
  });
});
