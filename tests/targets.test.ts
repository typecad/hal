import { describe, it, expect } from "vitest";
import { transpile, normalizeCpp, hasInclude, extractFunction } from "./setup";

describe("Target-Specific Transpilation", () => {
  describe("Generic Target", () => {
    it("generates standard C++ for generic target", () => {
      const result = transpile(`
        function add(a: int, b: int): int {
          return a + b;
        }
      `, { target: "generic" });
      
      // Return type is inferred from return statement
      expect(result.cpp).toContain("int add(int a, int b)");
      expect(result.cpp).toContain("return a + b");
    });

    it("rejects console.* with a diagnostic (the carry-over is gone)", () => {
      const result = transpile(`
        function test(): void {
          console.log("hello");
        }
      `, { target: "generic" });

      expect(result.diagnostics.some((d) => d.code === "console-unsupported")).toBe(true);
      expect(normalizeCpp(result.cpp)).not.toContain("std::cout");
    });

    it("includes standard headers for generic target", () => {
      const result = transpile(`
        function add(a: int, b: int): int {
          return a + b;
        }
      `, { target: "generic" });

      expect(hasInclude(result.cpp, "<iostream>")).toBe(false);
    });

    it("does not emit recursive top-level main() call inside main", () => {
      const result = transpile(`
        main();
        function main(): number {
          const x = 1;
          return x;
        }
      `, { target: "generic" });

      const mainBody = extractFunction(result.cpp, "main");
      expect(mainBody).not.toBeNull();
      expect(mainBody).not.toContain("main();");
      expect(mainBody).toContain("int x = 1");
    });

    it("auto-wires microtask pump in main for async runtime", () => {
      const result = transpile(`
        async function work(): int {
          return await getValue();
        }
        function getValue(): int {
          return 1;
        }
        function main(): int {
          return 0;
        }
      `, { target: "generic" });

      // Both targets use cuttlefish_pump_microtasks
      expect(result.cpp).toContain("inline void cuttlefish_pump_microtasks()");
      const mainBody = extractFunction(result.cpp, "main");
      expect(mainBody).not.toBeNull();
      expect(mainBody).toContain("cuttlefish_pump_microtasks();");
    });
  });

  describe("Type Representations Across Targets", () => {
    it("transpiles int consistently across targets", () => {
      const generic = transpile(`
        function test(): int {
          const x: int = 42;
          return x;
        }
      `, { target: "generic" });
      
      const arduino = transpile(`
        function test(): int {
          const x: int = 42;
          return x;
        }
      `, { target: "arduino" });
      
      expect(generic.cpp).toContain("const int x = 42");
      expect(arduino.cpp).toContain("const int x = 42");
    });

    it("transpiles float consistently across targets", () => {
      const generic = transpile(`
        function test(): float {
          const pi: float = 3.14;
          return pi;
        }
      `, { target: "generic" });
      
      const arduino = transpile(`
        function test(): float {
          const pi: float = 3.14;
          return pi;
        }
      `, { target: "arduino" });
      
      expect(generic.cpp).toContain("const float pi = 3.14");
      expect(arduino.cpp).toContain("const float pi = 3.14");
    });

    it("transpiles bool consistently across targets", () => {
      const generic = transpile(`
        function test(): bool {
          const flag: bool = true;
          return flag;
        }
      `, { target: "generic" });
      
      const arduino = transpile(`
        function test(): bool {
          const flag: bool = true;
          return flag;
        }
      `, { target: "arduino" });
      
      expect(generic.cpp).toContain("const bool flag = true");
      expect(arduino.cpp).toContain("const bool flag = true");
    });
  });

  describe("Control Flow Across Targets", () => {
    it("transpiles for loop consistently", () => {
      const generic = transpile(`
        function sum(): int {
          let total = 0;
          for (let i = 0; i < 10; i++) {
            total += i;
          }
          return total;
        }
      `, { target: "generic" });
      
      const arduino = transpile(`
        function sum(): int {
          let total = 0;
          for (let i = 0; i < 10; i++) {
            total += i;
          }
          return total;
        }
      `, { target: "arduino" });
      
      expect(generic.cpp).toContain("for (int i = 0; i < 10; i++)");
      expect(arduino.cpp).toContain("for (int i = 0; i < 10; i++)");
    });

    it("transpiles while loop consistently", () => {
      const generic = transpile(`
        function countdown(): int {
          let n = 10;
          while (n > 0) {
            n--;
          }
          return n;
        }
      `, { target: "generic" });
      
      const arduino = transpile(`
        function countdown(): int {
          let n = 10;
          while (n > 0) {
            n--;
          }
          return n;
        }
      `, { target: "arduino" });
      
      expect(generic.cpp).toContain("while (n > 0)");
      expect(arduino.cpp).toContain("while (n > 0)");
    });

    it("transpiles if-else consistently", () => {
      const generic = transpile(`
        function abs(x: int): int {
          if (x < 0) {
            return -x;
          } else {
            return x;
          }
        }
      `, { target: "generic" });
      
      const arduino = transpile(`
        function abs(x: int): int {
          if (x < 0) {
            return -x;
          } else {
            return x;
          }
        }
      `, { target: "arduino" });
      
      expect(generic.cpp).toContain("if (x < 0)");
      expect(arduino.cpp).toContain("if (x < 0)");
    });
  });

  describe("Function Features Across Targets", () => {
    it("transpiles function with parameters consistently", () => {
      const generic = transpile(`
        function multiply(a: int, b: int): int {
          return a * b;
        }
      `, { target: "generic" });
      
      const arduino = transpile(`
        function multiply(a: int, b: int): int {
          return a * b;
        }
      `, { target: "arduino" });
      
      // Return type is inferred from return statement
      expect(generic.cpp).toContain("int multiply(int a, int b)");
      expect(arduino.cpp).toContain("int multiply(int a, int b)");
    });

    it("transpiles recursive function consistently", () => {
      const generic = transpile(`
        function factorial(n: int): int {
          if (n <= 1) return 1;
          return n * factorial(n - 1);
        }
      `, { target: "generic" });
      
      const arduino = transpile(`
        function factorial(n: int): int {
          if (n <= 1) return 1;
          return n * factorial(n - 1);
        }
      `, { target: "arduino" });
      
      expect(generic.cpp).toContain("factorial(n - 1)");
      expect(arduino.cpp).toContain("factorial(n - 1)");
    });
  });

  describe("Multiple Representation Tests", () => {
    it("handles same logic with different number representations", () => {
      // Static number
      const staticNum = transpile(`
        function getValue(): int {
          return 42;
        }
      `, { target: "generic" });
      
      // Expression
      const expr = transpile(`
        function getValue(): int {
          return 6 * 7;
        }
      `, { target: "generic" });
      
      // Variable
      const variable = transpile(`
        function getValue(): int {
          const x = 42;
          return x;
        }
      `, { target: "generic" });
      
      expect(staticNum.cpp).toContain("return 42");
      expect(expr.cpp).toContain("return 6 * 7");
      expect(variable.cpp).toContain("return x");
    });

    it("handles same logic with different string representations", () => {
      // Literal
      const literal = transpile(`
        function greet(): string {
          return "hello";
        }
      `, { target: "generic" });

      // Variable
      const variable = transpile(`
        function greet(): string {
          const msg = "hello";
          return msg;
        }
      `, { target: "generic" });

      expect(literal.cpp).toContain('"hello"');
      expect(variable.cpp).toContain('"hello"');
    });

    it("handles same logic with different boolean representations", () => {
      // Literal true
      const literalTrue = transpile(`
        function isTrue(): bool {
          return true;
        }
      `, { target: "generic" });
      
      // Expression
      const expr = transpile(`
        function isTrue(): bool {
          return 1 == 1;
        }
      `, { target: "generic" });
      
      // Variable
      const variable = transpile(`
        function isTrue(): bool {
          const flag = true;
          return flag;
        }
      `, { target: "generic" });
      
      expect(literalTrue.cpp).toContain("return true");
      expect(expr.cpp).toContain("return 1 == 1");
      expect(variable.cpp).toContain("return flag");
    });

    it("handles same loop logic with different representations", () => {
      // Standard for loop
      const forLoop = transpile(`
        function sum(): int {
          let total = 0;
          for (let i = 0; i < 10; i++) {
            total += i;
          }
          return total;
        }
      `, { target: "generic" });
      
      // While loop equivalent
      const whileLoop = transpile(`
        function sum(): int {
          let total = 0;
          let i = 0;
          while (i < 10) {
            total += i;
            i++;
          }
          return total;
        }
      `, { target: "generic" });
      
      expect(forLoop.cpp).toContain("for (");
      expect(whileLoop.cpp).toContain("while (");
    });
  });

  describe("Complex Cross-Target Scenarios", () => {
    it("transpiles class with methods across targets", () => {
      const generic = transpile(`
        class Counter {
          private count: int = 0;
          public increment(): void {
            this.count++;
          }
          public getCount(): int {
            return this.count;
          }
        }
      `, { target: "generic" });
      
      const arduino = transpile(`
        class Counter {
          private count: int = 0;
          public increment(): void {
            this.count++;
          }
          public getCount(): int {
            return this.count;
          }
        }
      `, { target: "arduino" });
      
      expect(generic.cpp).toContain("class Counter");
      expect(arduino.cpp).toContain("class Counter");
    });

    it("transpiles enum across targets", () => {
      const generic = transpile(`
        enum State {
          Idle,
          Running,
          Stopped
        }
      `, { target: "generic" });
      
      const arduino = transpile(`
        enum State {
          Idle,
          Running,
          Stopped
        }
      `, { target: "arduino" });
      
      expect(generic.cpp).toContain("enum class State");
      expect(arduino.cpp).toContain("enum class State");
    });
  });
});