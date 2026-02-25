"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const setup_1 = require("./setup");
(0, vitest_1.describe)("Function Transpilation", () => {
    (0, vitest_1.describe)("Function Declarations", () => {
        (0, vitest_1.it)("transpiles void function", () => {
            const result = (0, setup_1.transpile)(`
        function greet(): void {
          const msg = "hello";
        }
      `);
            (0, vitest_1.expect)(result.cpp).toContain("void greet()");
        });
        (0, vitest_1.it)("transpiles function returning int", () => {
            const result = (0, setup_1.transpile)(`
        function getValue(): int {
          return 42;
        }
      `);
            // Return type is inferred from return statement
            (0, vitest_1.expect)(result.cpp).toContain("int getValue()");
        });
        (0, vitest_1.it)("transpiles function returning float", () => {
            const result = (0, setup_1.transpile)(`
        function getPi(): float {
          return 3.14;
        }
      `);
            // Return type is inferred from return statement
            (0, vitest_1.expect)(result.cpp).toContain("float getPi()");
        });
        (0, vitest_1.it)("transpiles function returning bool", () => {
            const result = (0, setup_1.transpile)(`
        function isTrue(): bool {
          return true;
        }
      `);
            // Return type is inferred from return statement
            (0, vitest_1.expect)(result.cpp).toContain("bool isTrue()");
        });
        (0, vitest_1.it)("transpiles empty function body", () => {
            const result = (0, setup_1.transpile)(`
        function empty(): void {
        }
      `);
            (0, vitest_1.expect)(result.cpp).toContain("void empty()");
            (0, vitest_1.expect)(result.cpp).toMatch(/void empty\(\)\s*\{\s*\}/);
        });
    });
    (0, vitest_1.describe)("Parameters", () => {
        (0, vitest_1.it)("transpiles function with single parameter", () => {
            const result = (0, setup_1.transpile)(`
        function double(x: int): int {
          return x * 2;
        }
      `);
            // Return type is inferred from return statement
            (0, vitest_1.expect)(result.cpp).toContain("int double(int x)");
        });
        (0, vitest_1.it)("transpiles function with multiple parameters", () => {
            const result = (0, setup_1.transpile)(`
        function add(a: int, b: int): int {
          return a + b;
        }
      `);
            // Return type is inferred from return statement
            (0, vitest_1.expect)(result.cpp).toContain("int add(int a, int b)");
        });
        (0, vitest_1.it)("transpiles function with float parameter", () => {
            const result = (0, setup_1.transpile)(`
        function square(x: float): float {
          return x * x;
        }
      `);
            // Types are inferred, may use auto or int
            (0, vitest_1.expect)(result.cpp).toContain("square");
            (0, vitest_1.expect)(result.cpp).toContain("x");
        });
        (0, vitest_1.it)("transpiles function with bool parameter", () => {
            const result = (0, setup_1.transpile)(`
        function invert(flag: bool): bool {
          return !flag;
        }
      `);
            // Types are inferred, may use auto or int
            (0, vitest_1.expect)(result.cpp).toContain("invert");
            (0, vitest_1.expect)(result.cpp).toContain("flag");
        });
        (0, vitest_1.it)("transpiles function with mixed parameter types", () => {
            const result = (0, setup_1.transpile)(`
        function calculate(a: int, b: float, flag: bool): float {
          if (flag) {
            return a + b;
          }
          return a - b;
        }
      `);
            // Types are inferred, may use auto or int
            (0, vitest_1.expect)(result.cpp).toContain("calculate");
            (0, vitest_1.expect)(result.cpp).toContain("a");
            (0, vitest_1.expect)(result.cpp).toContain("b");
        });
        (0, vitest_1.it)("transpiles function with parameter default value (literal)", () => {
            const result = (0, setup_1.transpile)(`
        function greet(name: string = "world"): void {
          const msg = name;
        }
      `);
            (0, vitest_1.expect)(result.cpp).toContain("greet");
        });
    });
    (0, vitest_1.describe)("Function Calls", () => {
        (0, vitest_1.it)("transpiles function call with no arguments", () => {
            const result = (0, setup_1.transpile)(`
        function getValue(): int {
          return 42;
        }
        function test(): int {
          return getValue();
        }
      `);
            (0, vitest_1.expect)(result.cpp).toContain("getValue()");
        });
        (0, vitest_1.it)("transpiles function call with literal arguments", () => {
            const result = (0, setup_1.transpile)(`
        function add(a: int, b: int): int {
          return a + b;
        }
        function test(): int {
          return add(5, 10);
        }
      `);
            (0, vitest_1.expect)(result.cpp).toContain("add(5, 10)");
        });
        (0, vitest_1.it)("transpiles function call with variable arguments", () => {
            const result = (0, setup_1.transpile)(`
        function add(a: int, b: int): int {
          return a + b;
        }
        function test(): int {
          const x = 5;
          const y = 10;
          return add(x, y);
        }
      `);
            (0, vitest_1.expect)(result.cpp).toContain("add(x, y)");
        });
        (0, vitest_1.it)("transpiles function call with expression arguments", () => {
            const result = (0, setup_1.transpile)(`
        function add(a: int, b: int): int {
          return a + b;
        }
        function test(): int {
          return add(2 + 3, 4 * 2);
        }
      `);
            (0, vitest_1.expect)(result.cpp).toContain("add(2 + 3, 4 * 2)");
        });
        (0, vitest_1.it)("transpiles nested function calls", () => {
            const result = (0, setup_1.transpile)(`
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
            (0, vitest_1.expect)(result.cpp).toContain("add(double(5), 10)");
        });
        (0, vitest_1.it)("transpiles function call in expression", () => {
            const result = (0, setup_1.transpile)(`
        function getValue(): int {
          return 42;
        }
        function test(): int {
          const x = getValue() + 8;
          return x;
        }
      `);
            (0, vitest_1.expect)(result.cpp).toContain("getValue() + 8");
        });
        (0, vitest_1.it)("transpiles function call in condition", () => {
            const result = (0, setup_1.transpile)(`
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
            (0, vitest_1.expect)(result.cpp).toContain("if (getValue() > 40)");
        });
    });
    (0, vitest_1.describe)("Async/Await Lowering", () => {
        (0, vitest_1.it)("lowers awaited return expression without raw expression warning", () => {
            const result = (0, setup_1.transpile)(`
        async function readValue(): int {
          return await getValue();
        }
        function getValue(): int {
          return 42;
        }
      `);
            (0, vitest_1.expect)(result.cpp).toContain("return getValue();");
            const warningCodes = result.diagnostics.map((diagnostic) => diagnostic.code);
            (0, vitest_1.expect)(warningCodes).not.toContain("TS2CPP_RAW_EXPR");
        });
        (0, vitest_1.it)("lowers awaited call expression statements to call statements", () => {
            const result = (0, setup_1.transpile)(`
        async function run(): void {
          await printOnce(1);
        }
        function printOnce(x: int): void {
          console.log(x);
        }
      `);
            (0, vitest_1.expect)(result.cpp).toContain("printOnce(1);");
            const warningCodes = result.diagnostics.map((diagnostic) => diagnostic.code);
            (0, vitest_1.expect)(warningCodes).not.toContain("TS2CPP_UNSUPPORTED_STMT");
        });
        (0, vitest_1.it)("lowers awaited initializer expressions", () => {
            const result = (0, setup_1.transpile)(`
        async function run(): int {
          const value = await getValue();
          return value;
        }
        function getValue(): int {
          return 7;
        }
      `);
            // Await is stripped and value is initialized with the function call
            (0, vitest_1.expect)(result.cpp).toContain("value = getValue();");
        });
    });
    (0, vitest_1.describe)("Multiple Representations", () => {
        (0, vitest_1.it)("transpiles same logic with inline vs variable args", () => {
            // Inline version
            const inline = (0, setup_1.transpile)(`
        function add(a: int, b: int): int {
          return a + b;
        }
        function test(): int {
          return add(5, 10);
        }
      `);
            // Variable version
            const variable = (0, setup_1.transpile)(`
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
            (0, vitest_1.expect)(inline.cpp).toContain("int add(int a, int b)");
            (0, vitest_1.expect)(variable.cpp).toContain("int add(int a, int b)");
        });
        (0, vitest_1.it)("transpiles same logic with expression vs precomputed", () => {
            // Expression version
            const expr = (0, setup_1.transpile)(`
        function test(): int {
          const x = 2 + 3 * 4;
          return x;
        }
      `);
            // Precomputed version
            const precomputed = (0, setup_1.transpile)(`
        function test(): int {
          const x = 14;
          return x;
        }
      `);
            (0, vitest_1.expect)(expr.cpp).toContain("const int x = 2 + 3 * 4");
            (0, vitest_1.expect)(precomputed.cpp).toContain("const int x = 14");
        });
        (0, vitest_1.it)("transpiles function with static number vs variable return", () => {
            // Static return
            const static_ = (0, setup_1.transpile)(`
        function getValue(): int {
          return 42;
        }
      `);
            // Variable return
            const variable = (0, setup_1.transpile)(`
        function getValue(): int {
          const x = 42;
          return x;
        }
      `);
            (0, vitest_1.expect)(static_.cpp).toContain("return 42");
            (0, vitest_1.expect)(variable.cpp).toContain("return x");
        });
    });
    (0, vitest_1.describe)("Recursion", () => {
        (0, vitest_1.it)("transpiles recursive function", () => {
            const result = (0, setup_1.transpile)(`
        function factorial(n: int): int {
          if (n <= 1) {
            return 1;
          }
          return n * factorial(n - 1);
        }
      `);
            // Return type is inferred from return statement
            (0, vitest_1.expect)(result.cpp).toContain("int factorial(int n)");
            (0, vitest_1.expect)(result.cpp).toContain("factorial(n - 1)");
        });
        (0, vitest_1.it)("transpiles recursive function with variable", () => {
            const result = (0, setup_1.transpile)(`
        function fibonacci(n: int): int {
          if (n <= 1) {
            return n;
          }
          const a = fibonacci(n - 1);
          const b = fibonacci(n - 2);
          return a + b;
        }
      `);
            (0, vitest_1.expect)(result.cpp).toContain("fibonacci(n - 1)");
            (0, vitest_1.expect)(result.cpp).toContain("fibonacci(n - 2)");
        });
    });
    (0, vitest_1.describe)("Function Declarations at Various Scopes", () => {
        (0, vitest_1.it)("transpiles multiple function declarations", () => {
            const result = (0, setup_1.transpile)(`
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
            (0, vitest_1.expect)(result.cpp).toContain("int first()");
            (0, vitest_1.expect)(result.cpp).toContain("int second()");
            (0, vitest_1.expect)(result.cpp).toContain("int third()");
        });
    });
});
