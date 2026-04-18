import { describe, it, expect } from "vitest";
import { transpile, normalizeCpp } from "./setup";

describe("Function Transpilation", () => {
  describe("Function Declarations", () => {
    it("transpiles void function", () => {
      const result = transpile(`
        function greet(): void {
          const msg = "hello";
        }
      `);
      expect(result.cpp).toContain("void greet()");
    });

    it("transpiles function returning int", () => {
      const result = transpile(`
        function getValue(): int {
          return 42;
        }
      `);
      // Return type is inferred from return statement
      expect(result.cpp).toContain("int getValue()");
    });

    it("transpiles function returning float", () => {
      const result = transpile(`
        function getPi(): float {
          return 3.14;
        }
      `);
      // Return type is inferred from return statement
      expect(result.cpp).toContain("float getPi()");
    });

    it("transpiles function returning bool", () => {
      const result = transpile(`
        function isTrue(): bool {
          return true;
        }
      `);
      // Return type is inferred from return statement
      expect(result.cpp).toContain("bool isTrue()");
    });

    it("transpiles empty function body", () => {
      const result = transpile(`
        function empty(): void {
        }
      `);
      expect(result.cpp).toContain("void empty()");
      expect(result.cpp).toMatch(/void empty\(\)\s*\{\s*\}/);
    });
  });

  describe("Parameters", () => {
    it("transpiles function with single parameter", () => {
      const result = transpile(`
        function double(x: int): int {
          return x * 2;
        }
      `);
      // Return type is inferred from return statement
      expect(result.cpp).toContain("int double(int x)");
    });

    it("transpiles function with multiple parameters", () => {
      const result = transpile(`
        function add(a: int, b: int): int {
          return a + b;
        }
      `);
      // Return type is inferred from return statement
      expect(result.cpp).toContain("int add(int a, int b)");
    });

    it("transpiles function with float parameter", () => {
      const result = transpile(`
        function square(x: float): float {
          return x * x;
        }
      `);
      const cpp = normalizeCpp(result.cpp);
      expect(cpp).toContain("float square(float x)");
      expect(cpp).toContain("return x * x;");
    });

    it("transpiles function with bool parameter", () => {
      const result = transpile(`
        function invert(flag: bool): bool {
          return !flag;
        }
      `);
      const cpp = normalizeCpp(result.cpp);
      expect(cpp).toContain("bool invert(bool flag)");
      expect(cpp).toContain("return !flag;");
    });

    it("transpiles function with mixed parameter types", () => {
      const result = transpile(`
        function calculate(a: int, b: float, flag: bool): float {
          if (flag) {
            return a + b;
          }
          return a - b;
        }
      `);
      const cpp = normalizeCpp(result.cpp);
      expect(cpp).toContain("float calculate(int a, float b, bool flag)");
      expect(cpp).toContain("return a + b;");
      expect(cpp).toContain("return a - b;");
    });

    it("transpiles function with parameter default value (literal)", () => {
      const result = transpile(`
        function greet(name: string = "world"): void {
          const msg = name;
        }
      `);
      const cpp = normalizeCpp(result.cpp);
      expect(cpp).toContain("void greet(std::string name = \"world\")");
      expect(cpp).toContain("const std::string msg = name;");
    });
  });

  describe("Function Calls", () => {
    it("transpiles function call with no arguments", () => {
      const result = transpile(`
        function getValue(): int {
          return 42;
        }
        function test(): int {
          return getValue();
        }
      `);
      expect(result.cpp).toContain("getValue()");
    });

    it("transpiles function call with literal arguments", () => {
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

    it("transpiles function call with variable arguments", () => {
      const result = transpile(`
        function add(a: int, b: int): int {
          return a + b;
        }
        function test(): int {
          const x = 5;
          const y = 10;
          return add(x, y);
        }
      `);
      expect(result.cpp).toContain("add(x, y)");
    });

    it("transpiles function call with expression arguments", () => {
      const result = transpile(`
        function add(a: int, b: int): int {
          return a + b;
        }
        function test(): int {
          return add(2 + 3, 4 * 2);
        }
      `);
      expect(result.cpp).toContain("add(2 + 3, 4 * 2)");
    });

    it("transpiles nested function calls", () => {
      const result = transpile(`
        function double(x: int): int {
          return x * 2;
        }
        function add(a: int, b: int): int {
          return a + b;
        }
        function test(): int {
          return add(double(5), 10);
        }
      `);
      expect(result.cpp).toContain("add(double(5), 10)");
    });

    it("transpiles function call in expression", () => {
      const result = transpile(`
        function getValue(): int {
          return 42;
        }
        function test(): int {
          const x = getValue() + 8;
          return x;
        }
      `);
      expect(result.cpp).toContain("getValue() + 8");
    });

    it("transpiles function call in condition", () => {
      const result = transpile(`
        function getValue(): int {
          return 42;
        }
        function test(): int {
          if (getValue() > 40) {
            return 1;
          }
          return 0;
        }
      `);
      expect(result.cpp).toContain("if (getValue() > 40)");
    });
  });

  describe("Async/Await Lowering", () => {
    it("lowers awaited return expression without raw expression warning", () => {
      const result = transpile(`
        async function readValue(): int {
          return await getValue();
        }
        function getValue(): int {
          return 42;
        }
      `);

      expect(result.cpp).toContain("return getValue();");
      const warningCodes = result.diagnostics.map((diagnostic) => diagnostic.code);
      expect(warningCodes).not.toContain("TS2CPP_RAW_EXPR");
    });

    it("lowers awaited call expression statements to call statements", () => {
      const result = transpile(`
        async function run(): void {
          await printOnce(1);
        }
        function printOnce(x: int): void {
          console.log(x);
        }
      `);

      // Async functions become cooperative state machines
      // The printOnce function is still emitted
      expect(result.cpp).toContain("void printOnce(int x)");
      const warningCodes = result.diagnostics.map((diagnostic) => diagnostic.code);
      expect(warningCodes).not.toContain("TS2CPP_UNSUPPORTED_STMT");
    });

    it("lowers awaited initializer expressions", () => {
      const result = transpile(`
        async function run(): int {
          const value = await getValue();
          return value;
        }
        function getValue(): int {
          return 7;
        }
      `);

      // Await is stripped and value is initialized with the function call
      expect(result.cpp).toContain("value = getValue();");
    });
  });

  describe("Multiple Representations", () => {
    it("transpiles same logic with inline vs variable args", () => {
      // Inline version
      const inline = transpile(`
        function add(a: int, b: int): int {
          return a + b;
        }
        function test(): int {
          return add(5, 10);
        }
      `);
      
      // Variable version
      const variable = transpile(`
        function add(a: int, b: int): int {
          return a + b;
        }
        function test(): int {
          const x = 5;
          const y = 10;
          return add(x, y);
        }
      `);
      
      // Return type is inferred from return statement
      expect(inline.cpp).toContain("int add(int a, int b)");
      expect(variable.cpp).toContain("int add(int a, int b)");
    });

    it("transpiles same logic with expression vs precomputed", () => {
      // Expression version
      const expr = transpile(`
        function test(): int {
          const x = 2 + 3 * 4;
          return x;
        }
      `);
      
      // Precomputed version
      const precomputed = transpile(`
        function test(): int {
          const x = 14;
          return x;
        }
      `);
      
      expect(expr.cpp).toContain("const int x = 2 + 3 * 4");
      expect(precomputed.cpp).toContain("const int x = 14");
    });

    it("transpiles function with static number vs variable return", () => {
      // Static return
      const static_ = transpile(`
        function getValue(): int {
          return 42;
        }
      `);
      
      // Variable return
      const variable = transpile(`
        function getValue(): int {
          const x = 42;
          return x;
        }
      `);
      
      expect(static_.cpp).toContain("return 42");
      expect(variable.cpp).toContain("return x");
    });
  });

  describe("Recursion", () => {
    it("transpiles recursive function", () => {
      const result = transpile(`
        function factorial(n: int): int {
          if (n <= 1) {
            return 1;
          }
          return n * factorial(n - 1);
        }
      `);
      // Return type is inferred from return statement
      expect(result.cpp).toContain("int factorial(int n)");
      expect(result.cpp).toContain("factorial(n - 1)");
    });

    it("transpiles recursive function with variable", () => {
      const result = transpile(`
        function fibonacci(n: int): int {
          if (n <= 1) {
            return n;
          }
          const a = fibonacci(n - 1);
          const b = fibonacci(n - 2);
          return a + b;
        }
      `);
      expect(result.cpp).toContain("fibonacci(n - 1)");
      expect(result.cpp).toContain("fibonacci(n - 2)");
    });
  });

  describe("Function Declarations at Various Scopes", () => {
    it("transpiles multiple function declarations", () => {
      const result = transpile(`
        function first(): int {
          return 1;
        }
        function second(): int {
          return 2;
        }
        function third(): int {
          return first() + second();
        }
      `);
      // Return types are inferred from return statements
      expect(result.cpp).toContain("int first()");
      expect(result.cpp).toContain("int second()");
      expect(result.cpp).toContain("int third()");
    });
  });
});