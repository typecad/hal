import { describe, it, expect } from "vitest";
import { transpile, normalizeCpp, hasInclude } from "./setup";
import { inferSnprintfArg, createEmissionScopeState } from "@typehal/transpiler/testing";

describe("Expression Transpilation", () => {
  describe("Number Literals", () => {
    it("transpiles integer literals", () => {
      const result = transpile(`
        function test(): int {
          const x = 42;
          return x;
        }
      `);
      expect(result.cpp).toContain("const int x = 42");
    });

    it("transpiles negative integers", () => {
      const result = transpile(`
        function test(): int {
          const x = -17;
          return x;
        }
      `);
      // Negative numbers are supported
      expect(result.cpp).toContain("-17");
    });

    it("transpiles floating point numbers", () => {
      const result = transpile(`
        function test(): float {
          const x = 3.14;
          return x;
        }
      `);
      expect(result.cpp).toContain("const double x = 3.14");
    });

    it("transpiles negative floats", () => {
      const result = transpile(`
        function test(): float {
          const x = -2.718;
          return x;
        }
      `);
      // Floats may have 'f' suffix
      expect(result.cpp).toContain("-2.718");
    });

    it("transpiles number used in expression", () => {
      const result = transpile(`
        function test(): int {
          let sum = 10 + 20;
          return sum;
        }
      `);
      expect(result.cpp).toContain("int sum = 10 + 20");
    });

    it("transpiles number passed as argument", () => {
      const result = transpile(`
        function add(a: int, b: int): int {
          return a + b;
        }
        function test(): int {
          return add(5, 10);
        }
      `);
      expect(result.cpp).toContain("add(5, 10)");
    });
  });

  describe("String Literals", () => {
    it("transpiles simple string literals", () => {
      const result = transpile(`
        function test(): void {
          const msg = "hello";
        }
      `);
      expect(result.cpp).toContain('const std::string msg = "hello"');
    });

    it("transpiles string with escaped quotes", () => {
      const result = transpile(`
        function test(): void {
          const msg = "say \\"hello\\"";
        }
      `);
      // Escaped quotes are preserved in output
      expect(result.cpp).toContain('const std::string msg = "say \\"hello\\""');
    });

    it("transpiles empty string", () => {
      const result = transpile(`
        function test(): void {
          const msg = "";
        }
      `);
      expect(result.cpp).toContain('const std::string msg = ""');
    });

    it("transpiles string in variable assignment", () => {
      const result = transpile(`
        function test(): void {
          let message = "initial";
          message = "updated";
        }
      `);
      expect(result.cpp).toContain('std::string message = "initial"');
      expect(result.cpp).toContain('message = "updated"');
    });

    it("uses snprintf for Arduino template literals", () => {
      const result = transpile([
        "function test(): void {",
        "  const temp = 24.5;",
        "  const msg = `Temp is ${temp}C`;",
        "}",
      ].join("\n"), { target: "arduino" });
      expect(hasInclude(result.cpp, "stdio.h")).toBe(true);
      expect(hasInclude(result.cpp, "stdlib.h")).toBe(true);
      expect(result.cpp).toContain("char msg[");
      expect(result.cpp).toContain("char __typehal_float_");
      expect(result.cpp).toContain("dtostrf(temp, 0, 1, __typehal_float_");
      expect(result.cpp).toContain('snprintf(msg, sizeof(msg), "Temp is %sC", __typehal_float_');
      expect(result.cpp).not.toContain("String(temp)");
    });

    it("uses snprintf for string concat as function argument", () => {
      const result = transpile([
        "function test(): void {",
        "  const x = 42;",
        "  console.log(`value: ${x}`);",
        "}",
      ].join("\n"), { target: "arduino" });
      expect(hasInclude(result.cpp, "stdio.h")).toBe(true);
      expect(result.cpp).toContain("snprintf(");
      expect(result.cpp).toContain("Serial.println(");
      expect(result.cpp).not.toContain("String(x)");
    });

    it("uses snprintf for string concat in return statement", () => {
      const result = transpile([
        "function test(): void {",
        "  const x = 42;",
        "  return `result: ${x}`;",
        "}",
      ].join("\n"), { target: "arduino" });
      expect(hasInclude(result.cpp, "stdio.h")).toBe(true);
      expect(result.cpp).toContain("snprintf(");
      expect(result.cpp).not.toContain("String(x)");
    });

    it("uses snprintf for multiple string concats in same function", () => {
      const result = transpile([
        "function test(): void {",
        "  const a = `first: ${1}`;",
        "  const b = `second: ${2}`;",
        "}",
      ].join("\n"), { target: "arduino" });
      expect(hasInclude(result.cpp, "stdio.h")).toBe(true);
      // Both variables should use snprintf
      expect(result.cpp).toContain("char a[");
      expect(result.cpp).toContain("char b[");
      expect(result.cpp).toContain('snprintf(a, sizeof(a), "first: %d", 1)');
      expect(result.cpp).toContain('snprintf(b, sizeof(b), "second: %d", 2)');
    });

    it("keeps std::string for generic target", () => {
      const result = transpile([
        "function test(): void {",
        "  const x = 42;",
        "  const msg = `value: ${x}`;",
        "}",
      ].join("\n"), { target: "generic" });
      expect(result.cpp).not.toContain("snprintf(");
      expect(result.cpp).not.toContain("char msg[");
    });

    it("resolves D3.read() inside template literal passed to println", () => {
      const result = transpile([
        "import { D3, UART0 } from '@typehal/board-arduino-uno';",
        "function test(): void {",
        "  const uart = UART0.begin(9600);",
        "  uart.println(`d3: ${D3.asInput().read()}`);",
        "}",
      ].join("\n"), { target: "arduino" });
      expect(result.cpp).toContain("digitalRead(3) == HIGH");
      expect(result.cpp).toContain("Serial.println");
    });
  });

  describe("Binary String Concatenation", () => {
    it("uses snprintf for string literal + int variable on Arduino", () => {
      const result = transpile([
        "function test(): void {",
        "  const flash = 32768;",
        '  const msg = "Flash: " + flash + " bytes";',
        "}",
      ].join("\n"), { target: "arduino" });
      expect(hasInclude(result.cpp, "stdio.h")).toBe(true);
      expect(result.cpp).toContain("char msg[");
      expect(result.cpp).toContain("snprintf(");
      expect(result.cpp).toContain("%d");
      expect(result.cpp).not.toContain("String(");
    });

    it("uses snprintf with dtostrf for string literal + float variable on Arduino", () => {
      const result = transpile([
        "function test(): void {",
        "  const val = 3.14;",
        '  const msg = "Value: " + val;',
        "}",
      ].join("\n"), { target: "arduino" });
      expect(hasInclude(result.cpp, "stdio.h")).toBe(true);
      expect(hasInclude(result.cpp, "stdlib.h")).toBe(true);
      expect(result.cpp).toContain("char msg[");
      expect(result.cpp).toContain("dtostrf(");
      expect(result.cpp).toContain("snprintf(");
      expect(result.cpp).not.toContain("String(");
    });

    it("uses snprintf for string var + string var concat on Arduino", () => {
      const result = transpile([
        "function test(): void {",
        '  const a = "hello";',
        '  const b = "world";',
        '  const c = a + " " + b;',
        "}",
      ].join("\n"), { target: "arduino" });
      expect(hasInclude(result.cpp, "stdio.h")).toBe(true);
      expect(result.cpp).toContain("char c[");
      expect(result.cpp).toContain("snprintf(");
      expect(result.cpp).not.toContain("String(");
    });

    it("does not use snprintf for string literal + int on generic target", () => {
      const result = transpile([
        "function test(): void {",
        "  const flash = 32768;",
        '  const msg = "Flash: " + flash + " bytes";',
        "}",
      ].join("\n"), { target: "generic" });
      expect(result.cpp).not.toContain("snprintf(");
      expect(result.cpp).not.toContain("char msg[");
    });
  });

  describe("Boolean Literals", () => {
    it("transpiles true literal", () => {
      const result = transpile(`
        function test(): bool {
          const flag = true;
          return flag;
        }
      `);
      expect(result.cpp).toContain("const bool flag = true");
    });

    it("transpiles false literal", () => {
      const result = transpile(`
        function test(): bool {
          const flag = false;
          return flag;
        }
      `);
      expect(result.cpp).toContain("const bool flag = false");
    });

    it("transpiles boolean in expression context", () => {
      const result = transpile(`
        function test(): bool {
          const enabled = true;
          const disabled = false;
          return enabled && !disabled;
        }
      `);
      expect(result.cpp).toContain("const bool enabled = true");
      expect(result.cpp).toContain("const bool disabled = false");
    });
  });

  describe("Identifiers", () => {
    it("transpiles identifier references", () => {
      const result = transpile(`
        function test(): int {
          const x = 10;
          const y = x;
          return y;
        }
      `);
      expect(result.cpp).toContain("const int x = 10");
      expect(result.cpp).toContain("const int y = x");
    });

    it("transpiles identifiers in expressions", () => {
      const result = transpile(`
        function test(): int {
          const a = 5;
          const b = 10;
          const c = a + b;
          return c;
        }
      `);
      expect(result.cpp).toContain("const int c = a + b");
    });

    it("transpiles function call as expression", () => {
      const result = transpile(`
        function getValue(): int {
          return 42;
        }
        function test(): int {
          const val = getValue();
          return val;
        }
      `);
      // Function call results use auto type inference
      expect(result.cpp).toContain("getValue()");
    });
  });

  describe("Ternary Expressions", () => {
    it("transpiles simple ternary expression", () => {
      const result = transpile(`
        function test(flag: bool): int {
          const value = flag ? 1 : 0;
          return value;
        }
      `);
      // Ternary uses explicit type inference from operands
      expect(result.cpp).toContain("const int value = (flag ? 1 : 0)");
    });

    it("transpiles ternary with variable operands", () => {
      const result = transpile(`
        function test(flag: bool): int {
          const a = 10;
          const b = 20;
          const result = flag ? a : b;
          return result;
        }
      `);
      // Ternary uses explicit type inference from operands
      expect(result.cpp).toContain("const int result = (flag ? a : b)");
    });

    it("transpiles nested ternary expressions", () => {
      const result = transpile(`
        function test(x: int): int {
          const value = x > 0 ? 1 : (x < 0 ? -1 : 0);
          return value;
        }
      `);
      expect(result.cpp).toContain("? 1 :");
      expect(result.cpp).toContain("? -1 : 0");
    });

    it("transpiles ternary in return statement", () => {
      const result = transpile(`
        function test(flag: bool): int {
          return flag ? 100 : 200;
        }
      `);
      expect(result.cpp).toContain("return (flag ? 100 : 200)");
    });
  });

  describe("Array Literals", () => {
    it("transpiles empty array", () => {
      const result = transpile(`
        function test(): void {
          const arr: int[] = [];
        }
      `);
      expect(result.cpp).toContain("const std::vector<int> arr = {");
    });

    it("transpiles array with number elements", () => {
      const result = transpile(`
        function test(): void {
          const arr = [1, 2, 3, 4, 5];
        }
      `);
      expect(result.cpp).toContain("const std::vector<int> arr = { 1, 2, 3, 4, 5 }");
    });

    it("transpiles array with variable elements", () => {
      const result = transpile(`
        function test(): void {
          const a = 1;
          const b = 2;
          const arr = [a, b];
        }
      `);
      expect(result.cpp).toContain("const std::vector<int> arr = { a, b }");
    });

    it("transpiles array with mixed literals and variables", () => {
      const result = transpile(`
        function test(): void {
          const x = 10;
          const arr = [0, x, 20];
        }
      `);
      expect(result.cpp).toContain("const std::vector<int> arr = { 0, x, 20 }");
    });

    it("emits vector stream helper when logging arrays", () => {
      const result = transpile(`
        function test(): void {
          const arr = [1, 2, 3];
          console.log(arr);
        }
      `);
      expect(result.cpp).toContain("template <typename T>");
      expect(result.cpp).toContain("operator<<(std::ostream& os, const std::vector<T>& values)");
      expect(result.cpp).toContain("std::cout << arr << std::endl");
    });
  });

  describe("Object Literals", () => {
    it("transpiles simple object literal", () => {
      const result = transpile(`
        function test(): void {
          const obj = { x: 1, y: 2 };
        }
      `);
      expect(result.cpp).toContain("struct _obj_t");
      expect(result.cpp).toContain("obj = { 1, 2 }");
    });

    it("transpiles object with various field types", () => {
      const result = transpile(`
        function test(): void {
          const obj = { name: "test", count: 42, active: true };
        }
      `);
      expect(result.cpp).toContain("obj = { \"test\", 42, true }");
    });

    it("transpiles object with variable field values", () => {
      const result = transpile(`
        function test(): void {
          const val = 100;
          const obj = { value: val };
        }
      `);
      expect(result.cpp).toContain("obj = { val }");
    });
  });

  describe("Binary Expressions", () => {
    it("transpiles addition", () => {
      const result = transpile(`
        function test(): int {
          const sum = 5 + 3;
          return sum;
        }
      `);
      expect(result.cpp).toContain("const int sum = 5 + 3");
    });

    it("transpiles subtraction", () => {
      const result = transpile(`
        function test(): int {
          const diff = 10 - 4;
          return diff;
        }
      `);
      expect(result.cpp).toContain("const int diff = 10 - 4");
    });

    it("transpiles multiplication", () => {
      const result = transpile(`
        function test(): int {
          const product = 6 * 7;
          return product;
        }
      `);
      expect(result.cpp).toContain("const int product = 6 * 7");
    });

    it("transpiles division", () => {
      const result = transpile(`
        function test(): int {
          const quotient = 20 / 4;
          return quotient;
        }
      `);
      expect(result.cpp).toContain("const int quotient = 20 / 4");
    });

    it("transpiles modulo", () => {
      const result = transpile(`
        function test(): int {
          const remainder = 17 % 5;
          return remainder;
        }
      `);
      expect(result.cpp).toContain("const int remainder = 17 % 5");
    });

    it("transpiles comparison operators", () => {
      const result = transpile(`
        function test(): bool {
          const a = 5 > 3;
          const b = 5 < 3;
          const c = 5 >= 5;
          const d = 5 <= 4;
          const e = 5 == 5;
          const f = 5 != 3;
          return a && b && c && d && e && f;
        }
      `);
      expect(result.cpp).toContain("const bool a = 5 > 3");
      expect(result.cpp).toContain("const bool b = 5 < 3");
      expect(result.cpp).toContain("const bool c = 5 >= 5");
      expect(result.cpp).toContain("const bool d = 5 <= 4");
    });

    it("transpiles logical operators", () => {
      const result = transpile(`
        function test(): bool {
          const a = true && false;
          const b = true || false;
          const c = !true;
          return a || b || c;
        }
      `);
      expect(result.cpp).toContain("const bool a = true && false");
      expect(result.cpp).toContain("const bool b = true || false");
      // Logical not uses explicit type inference
      expect(result.cpp).toContain("const int c = !true");
    });

    it("transpiles bitwise operators", () => {
      const result = transpile(`
        function test(): int {
          const a = 5 & 3;
          const b = 5 | 3;
          const c = 5 ^ 3;
          const d = 5 << 1;
          const e = 5 >> 1;
          return a + b + c + d + e;
        }
      `);
      expect(result.cpp).toContain("const int a = 5 & 3");
      expect(result.cpp).toContain("const int b = 5 | 3");
      expect(result.cpp).toContain("const int c = 5 ^ 3");
    });
  });
});

// ---------------------------------------------------------------------------
// Unit tests for inferSnprintfArg — property-access format selection
// ---------------------------------------------------------------------------

describe("inferSnprintfArg property-access", () => {
  // Minimal mock: the only method called for property-access is renderExpression.
  const mockStrategy: any = {};
  const scopeState = createEmissionScopeState();
  const propAccessExpr: any = { kind: "property-access", object: { kind: "identifier", value: "Board" }, property: "mcu" };

  it("uses %s format when rendered value is a C++ string literal (board string constant)", () => {
    const result = inferSnprintfArg(propAccessExpr, mockStrategy, scopeState, () => '"ATmega328P"');
    expect(result?.format).toBe("%s");
    expect(result?.arg).toBe('"ATmega328P"');
  });

  it("uses %ld format when rendered value exceeds AVR int16 max (e.g. flash = 32768)", () => {
    const result = inferSnprintfArg(propAccessExpr, mockStrategy, scopeState, () => "32768");
    expect(result?.format).toBe("%ld");
    expect(result?.arg).toBe("32768L");
  });

  it("uses %ld format when rendered value is below AVR int16 min (e.g. -32769)", () => {
    const result = inferSnprintfArg(propAccessExpr, mockStrategy, scopeState, () => "-32769");
    expect(result?.format).toBe("%ld");
    expect(result?.arg).toBe("-32769L");
  });

  it("uses %d format for values that fit in AVR int16 (e.g. clockSpeed / 1000 = 16)", () => {
    const result = inferSnprintfArg(propAccessExpr, mockStrategy, scopeState, () => "16");
    expect(result?.format).toBe("%d");
    expect(result?.arg).toBe("16");
  });

  it("uses %d format for zero", () => {
    const result = inferSnprintfArg(propAccessExpr, mockStrategy, scopeState, () => "0");
    expect(result?.format).toBe("%d");
    expect(result?.arg).toBe("0");
  });

  it("uses %d format for AVR int16 boundary value 32767", () => {
    const result = inferSnprintfArg(propAccessExpr, mockStrategy, scopeState, () => "32767");
    expect(result?.format).toBe("%d");
    expect(result?.arg).toBe("32767");
  });
});