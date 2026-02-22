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
      
      // Uses auto return type when not explicitly annotated
      expect(result.cpp).toContain("auto add(int a, int b)");
      expect(result.cpp).toContain("return a + b");
    });

    it("uses std::cout for console in generic target", () => {
      const result = transpile(`
        function test(): void {
          console.log("hello");
        }
      `, { target: "generic" });
      
      expect(result.cpp).toContain("std::cout");
    });

    it("includes standard headers for generic target", () => {
      const result = transpile(`
        function test(): void {
          console.log("hello");
        }
      `, { target: "generic" });
      
      expect(hasInclude(result.cpp, "<iostream>")).toBe(true);
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

      expect(result.cpp).toContain("inline void ts2cpp_pump_microtasks()");
      const mainBody = extractFunction(result.cpp, "main");
      expect(mainBody).not.toBeNull();
      expect(mainBody).toContain("ts2cpp_pump_microtasks();");
    });
  });

  describe("Arduino Target", () => {
    it("generates Arduino-compatible code", () => {
      const result = transpile(`
        function setup(): void {
          const x = 1;
        }
        function loop(): void {
          const y = 2;
        }
      `, { target: "arduino" });
      
      expect(result.cpp).toContain("void setup()");
      expect(result.cpp).toContain("void loop()");
    });

    it("uses Serial for console in Arduino target", () => {
      const result = transpile(`
        function test(): void {
          console.log("hello");
        }
      `, { target: "arduino" });
      
      expect(result.cpp).toContain("Serial");
    });

    it("generates Serial.println for console.log in Arduino", () => {
      const result = transpile(`
        function test(): void {
          console.log("hello");
        }
      `, { target: "arduino" });
      
      expect(result.cpp).toContain("Serial.println");
    });

    it("does not emit recursive top-level setup() call inside setup", () => {
      const result = transpile(`
        setup();
        function setup(): void {
          const x = 1;
        }
        function loop(): void {
        }
      `, { target: "arduino" });

      const setupBody = extractFunction(result.cpp, "setup");
      expect(setupBody).not.toBeNull();
      expect(setupBody).not.toContain("setup();");
      expect(setupBody).toContain("const int x = 1");
    });

    it("auto-wires microtask pump in loop when async runtime is present", () => {
      const result = transpile(`
        async function readSensor(): int {
          return await value();
        }
        function value(): int {
          return 3;
        }
        function setup(): void {
        }
        function loop(): void {
        }
      `, { target: "arduino" });

      const loopBody = extractFunction(result.cpp, "loop");
      expect(loopBody).not.toBeNull();
      expect(loopBody).toContain("ts2cpp_pump_microtasks();");
      expect(result.cpp).toContain("inline void ts2cpp_pump_microtasks()");
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
      
      // Uses auto return type when not explicitly annotated
      expect(generic.cpp).toContain("auto multiply(int a, int b)");
      expect(arduino.cpp).toContain("auto multiply(int a, int b)");
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
        function greet(): void {
          console.log("hello");
        }
      `, { target: "generic" });
      
      // Variable
      const variable = transpile(`
        function greet(): void {
          const msg = "hello";
          console.log(msg);
        }
      `, { target: "generic" });
      
      // Console.log is transformed directly to std::cout
      expect(literal.cpp).toContain("std::cout");
      expect(variable.cpp).toContain("std::cout");
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