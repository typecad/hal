"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const setup_1 = require("./setup");
(0, vitest_1.describe)("Target-Specific Transpilation", () => {
    (0, vitest_1.describe)("Generic Target", () => {
        (0, vitest_1.it)("generates standard C++ for generic target", () => {
            const result = (0, setup_1.transpile)(`
        function add(a: int, b: int): int {
          return a + b;
        }
      `, { target: "generic" });
            // Return type is inferred from return statement
            (0, vitest_1.expect)(result.cpp).toContain("int add(int a, int b)");
            (0, vitest_1.expect)(result.cpp).toContain("return a + b");
        });
        (0, vitest_1.it)("uses std::cout for console in generic target", () => {
            const result = (0, setup_1.transpile)(`
        function test(): void {
          console.log("hello");
        }
      `, { target: "generic" });
            (0, vitest_1.expect)(result.cpp).toContain("std::cout");
        });
        (0, vitest_1.it)("includes standard headers for generic target", () => {
            const result = (0, setup_1.transpile)(`
        function test(): void {
          console.log("hello");
        }
      `, { target: "generic" });
            (0, vitest_1.expect)((0, setup_1.hasInclude)(result.cpp, "<iostream>")).toBe(true);
        });
        (0, vitest_1.it)("does not emit recursive top-level main() call inside main", () => {
            const result = (0, setup_1.transpile)(`
        main();
        function main(): number {
          const x = 1;
          return x;
        }
      `, { target: "generic" });
            const mainBody = (0, setup_1.extractFunction)(result.cpp, "main");
            (0, vitest_1.expect)(mainBody).not.toBeNull();
            (0, vitest_1.expect)(mainBody).not.toContain("main();");
            (0, vitest_1.expect)(mainBody).toContain("int x = 1");
        });
        (0, vitest_1.it)("auto-wires microtask pump in main for async runtime", () => {
            const result = (0, setup_1.transpile)(`
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
            (0, vitest_1.expect)(result.cpp).toContain("inline void ts2cpp_pump_microtasks()");
            const mainBody = (0, setup_1.extractFunction)(result.cpp, "main");
            (0, vitest_1.expect)(mainBody).not.toBeNull();
            (0, vitest_1.expect)(mainBody).toContain("ts2cpp_pump_microtasks();");
        });
    });
    (0, vitest_1.describe)("Arduino Target", () => {
        (0, vitest_1.it)("generates Arduino-compatible code", () => {
            const result = (0, setup_1.transpile)(`
        function setup(): void {
          const x = 1;
        }
        function loop(): void {
          const y = 2;
        }
      `, { target: "arduino" });
            (0, vitest_1.expect)(result.cpp).toContain("void setup()");
            (0, vitest_1.expect)(result.cpp).toContain("void loop()");
        });
        (0, vitest_1.it)("uses Serial for console in Arduino target", () => {
            const result = (0, setup_1.transpile)(`
        function test(): void {
          console.log("hello");
        }
      `, { target: "arduino" });
            (0, vitest_1.expect)(result.cpp).toContain("Serial");
        });
        (0, vitest_1.it)("generates Serial.println for console.log in Arduino", () => {
            const result = (0, setup_1.transpile)(`
        function test(): void {
          console.log("hello");
        }
      `, { target: "arduino" });
            (0, vitest_1.expect)(result.cpp).toContain("Serial.println");
        });
        (0, vitest_1.it)("does not emit recursive top-level setup() call inside setup", () => {
            const result = (0, setup_1.transpile)(`
        setup();
        function setup(): void {
          const x = 1;
        }
        function loop(): void {
        }
      `, { target: "arduino" });
            const setupBody = (0, setup_1.extractFunction)(result.cpp, "setup");
            (0, vitest_1.expect)(setupBody).not.toBeNull();
            (0, vitest_1.expect)(setupBody).not.toContain("setup();");
            (0, vitest_1.expect)(setupBody).toContain("const int x = 1");
        });
        (0, vitest_1.it)("auto-wires microtask pump in loop when async runtime is present", () => {
            const result = (0, setup_1.transpile)(`
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
            const loopBody = (0, setup_1.extractFunction)(result.cpp, "loop");
            (0, vitest_1.expect)(loopBody).not.toBeNull();
            (0, vitest_1.expect)(loopBody).toContain("ts2cpp_pump_microtasks();");
            (0, vitest_1.expect)(result.cpp).toContain("inline void ts2cpp_pump_microtasks()");
        });
    });
    (0, vitest_1.describe)("Type Representations Across Targets", () => {
        (0, vitest_1.it)("transpiles int consistently across targets", () => {
            const generic = (0, setup_1.transpile)(`
        function test(): int {
          const x: int = 42;
          return x;
        }
      `, { target: "generic" });
            const arduino = (0, setup_1.transpile)(`
        function test(): int {
          const x: int = 42;
          return x;
        }
      `, { target: "arduino" });
            (0, vitest_1.expect)(generic.cpp).toContain("const int x = 42");
            (0, vitest_1.expect)(arduino.cpp).toContain("const int x = 42");
        });
        (0, vitest_1.it)("transpiles float consistently across targets", () => {
            const generic = (0, setup_1.transpile)(`
        function test(): float {
          const pi: float = 3.14;
          return pi;
        }
      `, { target: "generic" });
            const arduino = (0, setup_1.transpile)(`
        function test(): float {
          const pi: float = 3.14;
          return pi;
        }
      `, { target: "arduino" });
            (0, vitest_1.expect)(generic.cpp).toContain("const float pi = 3.14");
            (0, vitest_1.expect)(arduino.cpp).toContain("const float pi = 3.14");
        });
        (0, vitest_1.it)("transpiles bool consistently across targets", () => {
            const generic = (0, setup_1.transpile)(`
        function test(): bool {
          const flag: bool = true;
          return flag;
        }
      `, { target: "generic" });
            const arduino = (0, setup_1.transpile)(`
        function test(): bool {
          const flag: bool = true;
          return flag;
        }
      `, { target: "arduino" });
            (0, vitest_1.expect)(generic.cpp).toContain("const bool flag = true");
            (0, vitest_1.expect)(arduino.cpp).toContain("const bool flag = true");
        });
    });
    (0, vitest_1.describe)("Control Flow Across Targets", () => {
        (0, vitest_1.it)("transpiles for loop consistently", () => {
            const generic = (0, setup_1.transpile)(`
        function sum(): int {
          let total = 0;
          for (let i = 0; i < 10; i++) {
            total += i;
          }
          return total;
        }
      `, { target: "generic" });
            const arduino = (0, setup_1.transpile)(`
        function sum(): int {
          let total = 0;
          for (let i = 0; i < 10; i++) {
            total += i;
          }
          return total;
        }
      `, { target: "arduino" });
            (0, vitest_1.expect)(generic.cpp).toContain("for (int i = 0; i < 10; i++)");
            (0, vitest_1.expect)(arduino.cpp).toContain("for (int i = 0; i < 10; i++)");
        });
        (0, vitest_1.it)("transpiles while loop consistently", () => {
            const generic = (0, setup_1.transpile)(`
        function countdown(): int {
          let n = 10;
          while (n > 0) {
            n--;
          }
          return n;
        }
      `, { target: "generic" });
            const arduino = (0, setup_1.transpile)(`
        function countdown(): int {
          let n = 10;
          while (n > 0) {
            n--;
          }
          return n;
        }
      `, { target: "arduino" });
            (0, vitest_1.expect)(generic.cpp).toContain("while (n > 0)");
            (0, vitest_1.expect)(arduino.cpp).toContain("while (n > 0)");
        });
        (0, vitest_1.it)("transpiles if-else consistently", () => {
            const generic = (0, setup_1.transpile)(`
        function abs(x: int): int {
          if (x < 0) {
            return -x;
          } else {
            return x;
          }
        }
      `, { target: "generic" });
            const arduino = (0, setup_1.transpile)(`
        function abs(x: int): int {
          if (x < 0) {
            return -x;
          } else {
            return x;
          }
        }
      `, { target: "arduino" });
            (0, vitest_1.expect)(generic.cpp).toContain("if (x < 0)");
            (0, vitest_1.expect)(arduino.cpp).toContain("if (x < 0)");
        });
    });
    (0, vitest_1.describe)("Function Features Across Targets", () => {
        (0, vitest_1.it)("transpiles function with parameters consistently", () => {
            const generic = (0, setup_1.transpile)(`
        function multiply(a: int, b: int): int {
          return a * b;
        }
      `, { target: "generic" });
            const arduino = (0, setup_1.transpile)(`
        function multiply(a: int, b: int): int {
          return a * b;
        }
      `, { target: "arduino" });
            // Return type is inferred from return statement
            (0, vitest_1.expect)(generic.cpp).toContain("int multiply(int a, int b)");
            (0, vitest_1.expect)(arduino.cpp).toContain("int multiply(int a, int b)");
        });
        (0, vitest_1.it)("transpiles recursive function consistently", () => {
            const generic = (0, setup_1.transpile)(`
        function factorial(n: int): int {
          if (n <= 1) return 1;
          return n * factorial(n - 1);
        }
      `, { target: "generic" });
            const arduino = (0, setup_1.transpile)(`
        function factorial(n: int): int {
          if (n <= 1) return 1;
          return n * factorial(n - 1);
        }
      `, { target: "arduino" });
            (0, vitest_1.expect)(generic.cpp).toContain("factorial(n - 1)");
            (0, vitest_1.expect)(arduino.cpp).toContain("factorial(n - 1)");
        });
    });
    (0, vitest_1.describe)("Multiple Representation Tests", () => {
        (0, vitest_1.it)("handles same logic with different number representations", () => {
            // Static number
            const staticNum = (0, setup_1.transpile)(`
        function getValue(): int {
          return 42;
        }
      `, { target: "generic" });
            // Expression
            const expr = (0, setup_1.transpile)(`
        function getValue(): int {
          return 6 * 7;
        }
      `, { target: "generic" });
            // Variable
            const variable = (0, setup_1.transpile)(`
        function getValue(): int {
          const x = 42;
          return x;
        }
      `, { target: "generic" });
            (0, vitest_1.expect)(staticNum.cpp).toContain("return 42");
            (0, vitest_1.expect)(expr.cpp).toContain("return 6 * 7");
            (0, vitest_1.expect)(variable.cpp).toContain("return x");
        });
        (0, vitest_1.it)("handles same logic with different string representations", () => {
            // Literal
            const literal = (0, setup_1.transpile)(`
        function greet(): void {
          console.log("hello");
        }
      `, { target: "generic" });
            // Variable
            const variable = (0, setup_1.transpile)(`
        function greet(): void {
          const msg = "hello";
          console.log(msg);
        }
      `, { target: "generic" });
            // Console.log is transformed directly to std::cout
            (0, vitest_1.expect)(literal.cpp).toContain("std::cout");
            (0, vitest_1.expect)(variable.cpp).toContain("std::cout");
        });
        (0, vitest_1.it)("handles same logic with different boolean representations", () => {
            // Literal true
            const literalTrue = (0, setup_1.transpile)(`
        function isTrue(): bool {
          return true;
        }
      `, { target: "generic" });
            // Expression
            const expr = (0, setup_1.transpile)(`
        function isTrue(): bool {
          return 1 == 1;
        }
      `, { target: "generic" });
            // Variable
            const variable = (0, setup_1.transpile)(`
        function isTrue(): bool {
          const flag = true;
          return flag;
        }
      `, { target: "generic" });
            (0, vitest_1.expect)(literalTrue.cpp).toContain("return true");
            (0, vitest_1.expect)(expr.cpp).toContain("return 1 == 1");
            (0, vitest_1.expect)(variable.cpp).toContain("return flag");
        });
        (0, vitest_1.it)("handles same loop logic with different representations", () => {
            // Standard for loop
            const forLoop = (0, setup_1.transpile)(`
        function sum(): int {
          let total = 0;
          for (let i = 0; i < 10; i++) {
            total += i;
          }
          return total;
        }
      `, { target: "generic" });
            // While loop equivalent
            const whileLoop = (0, setup_1.transpile)(`
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
            (0, vitest_1.expect)(forLoop.cpp).toContain("for (");
            (0, vitest_1.expect)(whileLoop.cpp).toContain("while (");
        });
    });
    (0, vitest_1.describe)("Complex Cross-Target Scenarios", () => {
        (0, vitest_1.it)("transpiles class with methods across targets", () => {
            const generic = (0, setup_1.transpile)(`
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
            const arduino = (0, setup_1.transpile)(`
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
            (0, vitest_1.expect)(generic.cpp).toContain("class Counter");
            (0, vitest_1.expect)(arduino.cpp).toContain("class Counter");
        });
        (0, vitest_1.it)("transpiles enum across targets", () => {
            const generic = (0, setup_1.transpile)(`
        enum State {
          Idle,
          Running,
          Stopped
        }
      `, { target: "generic" });
            const arduino = (0, setup_1.transpile)(`
        enum State {
          Idle,
          Running,
          Stopped
        }
      `, { target: "arduino" });
            (0, vitest_1.expect)(generic.cpp).toContain("enum class State");
            (0, vitest_1.expect)(arduino.cpp).toContain("enum class State");
        });
    });
});
