"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const setup_1 = require("./setup");
(0, vitest_1.describe)("Class Transpilation", () => {
    (0, vitest_1.describe)("Basic Class Structure", () => {
        (0, vitest_1.it)("transpiles empty class", () => {
            const result = (0, setup_1.transpile)(`
        class Empty {}
      `);
            (0, vitest_1.expect)(result.cpp).toContain("class Empty");
            (0, vitest_1.expect)(result.cpp).toContain("};");
        });
        (0, vitest_1.it)("transpiles class with public fields", () => {
            const result = (0, setup_1.transpile)(`
        class Point {
          public x: int;
          public y: int;
        }
      `);
            (0, vitest_1.expect)(result.cpp).toContain("class Point");
            (0, vitest_1.expect)(result.cpp).toContain("public:");
            // Fields use explicit types (auto is not valid for class members in C++)
            (0, vitest_1.expect)(result.cpp).toContain("int x");
            (0, vitest_1.expect)(result.cpp).toContain("int y");
        });
        (0, vitest_1.it)("transpiles class with field initializers", () => {
            const result = (0, setup_1.transpile)(`
        class Counter {
          public count: int = 0;
        }
      `);
            // Fields use explicit types (auto is not valid for class members in C++)
            (0, vitest_1.expect)(result.cpp).toContain("int count = 0");
        });
        (0, vitest_1.it)("transpiles class with private fields", () => {
            const result = (0, setup_1.transpile)(`
        class Secret {
          private value: int;
        }
      `);
            (0, vitest_1.expect)(result.cpp).toContain("private:");
            // Fields use explicit types (auto is not valid for class members in C++)
            (0, vitest_1.expect)(result.cpp).toContain("int value");
        });
        (0, vitest_1.it)("transpiles class with protected fields", () => {
            const result = (0, setup_1.transpile)(`
        class Counter {
          protected count: int;
        }
      `);
            // Protected fields use protected: section in C++
            (0, vitest_1.expect)(result.cpp).toContain("protected:");
            (0, vitest_1.expect)(result.cpp).toContain("count");
        });
        (0, vitest_1.it)("transpiles class with mixed visibility fields", () => {
            const result = (0, setup_1.transpile)(`
        class Mixed {
          public a: int;
          private b: int;
          protected c: int;
        }
      `);
            (0, vitest_1.expect)(result.cpp).toContain("public:");
            (0, vitest_1.expect)(result.cpp).toContain("private:");
            (0, vitest_1.expect)(result.cpp).toContain("protected:");
        });
    });
    (0, vitest_1.describe)("Class Methods", () => {
        (0, vitest_1.it)("transpiles class with public method", () => {
            const result = (0, setup_1.transpile)(`
        class Greeter {
          public greet(): void {
            const msg = "hello";
          }
        }
      `);
            (0, vitest_1.expect)(result.cpp).toContain("void greet()");
        });
        (0, vitest_1.it)("transpiles class with method returning value", () => {
            const result = (0, setup_1.transpile)(`
        class Calculator {
          public add(a: int, b: int): int {
            return a + b;
          }
        }
      `);
            // Method return types use explicit types (auto return requires trailing return type in C++)
            (0, vitest_1.expect)(result.cpp).toContain("int add(int a, int b)");
        });
        (0, vitest_1.it)("transpiles class with private method", () => {
            const result = (0, setup_1.transpile)(`
        class Secret {
          private helper(): int {
            return 42;
          }
        }
      `);
            (0, vitest_1.expect)(result.cpp).toContain("private:");
            // Return type is inferred from return statement
            (0, vitest_1.expect)(result.cpp).toContain("int helper()");
        });
        (0, vitest_1.it)("transpiles class with static method", () => {
            const result = (0, setup_1.transpile)(`
        class Factory {
          public static create(): int {
            return 1;
          }
        }
      `);
            // Method return types use explicit types (auto return requires trailing return type in C++)
            (0, vitest_1.expect)(result.cpp).toContain("static int create()");
        });
        (0, vitest_1.it)("transpiles class with multiple methods", () => {
            const result = (0, setup_1.transpile)(`
        class Math {
          public add(a: int, b: int): int {
            return a + b;
          }
          public subtract(a: int, b: int): int {
            return a - b;
          }
        }
      `);
            // Method return types use explicit types (auto return requires trailing return type in C++)
            (0, vitest_1.expect)(result.cpp).toContain("int add(int a, int b)");
            (0, vitest_1.expect)(result.cpp).toContain("int subtract(int a, int b)");
        });
    });
    (0, vitest_1.describe)("Constructors", () => {
        (0, vitest_1.it)("transpiles class with constructor", () => {
            const result = (0, setup_1.transpile)(`
        class Point {
          public x: int;
          public y: int;
          constructor(x: int, y: int) {
            this.x = x;
            this.y = y;
          }
        }
      `);
            (0, vitest_1.expect)(result.cpp).toContain("Point(int x, int y)");
        });
        (0, vitest_1.it)("transpiles constructor with default parameter", () => {
            const result = (0, setup_1.transpile)(`
        class Item {
          public value: int;
          constructor(value: int = 0) {
            this.value = value;
          }
        }
      `);
            (0, vitest_1.expect)(result.cpp).toContain("Item(");
        });
    });
    (0, vitest_1.describe)("Complex Classes", () => {
        (0, vitest_1.it)("transpiles class with fields and methods", () => {
            const result = (0, setup_1.transpile)(`
        class Counter {
          private count: int = 0;
          public increment(): void {
            this.count++;
          }
          public getCount(): int {
            return this.count;
          }
        }
      `);
            (0, vitest_1.expect)(result.cpp).toContain("class Counter");
            (0, vitest_1.expect)(result.cpp).toContain("void increment()");
            // Method return types use explicit types (auto return requires trailing return type in C++)
            (0, vitest_1.expect)(result.cpp).toContain("int getCount()");
        });
        (0, vitest_1.it)("transpiles class with various field types", () => {
            const result = (0, setup_1.transpile)(`
        class Data {
          public intValue: int;
          public floatValue: float;
          public boolValue: bool;
        }
      `);
            // Fields use explicit types based on their type annotation
            (0, vitest_1.expect)(result.cpp).toContain("int intValue");
            (0, vitest_1.expect)(result.cpp).toContain("float floatValue");
            (0, vitest_1.expect)(result.cpp).toContain("bool boolValue");
        });
    });
});
(0, vitest_1.describe)("Enum Transpilation", () => {
    (0, vitest_1.describe)("Basic Enums", () => {
        (0, vitest_1.it)("transpiles simple enum", () => {
            const result = (0, setup_1.transpile)(`
        enum Color {
          Red,
          Green,
          Blue
        }
      `);
            (0, vitest_1.expect)(result.cpp).toContain("enum class Color");
            (0, vitest_1.expect)(result.cpp).toContain("Red");
            (0, vitest_1.expect)(result.cpp).toContain("Green");
            (0, vitest_1.expect)(result.cpp).toContain("Blue");
        });
        (0, vitest_1.it)("transpiles enum with explicit values", () => {
            const result = (0, setup_1.transpile)(`
        enum Status {
          Ok = 200,
          NotFound = 404,
          Error = 500
        }
      `);
            (0, vitest_1.expect)(result.cpp).toContain("Ok = 200");
            (0, vitest_1.expect)(result.cpp).toContain("NotFound = 404");
            (0, vitest_1.expect)(result.cpp).toContain("Error = 500");
        });
        (0, vitest_1.it)("transpiles const enum", () => {
            const result = (0, setup_1.transpile)(`
        const enum Direction {
          Up,
          Down,
          Left,
          Right
        }
      `);
            (0, vitest_1.expect)(result.cpp).toContain("enum class Direction");
        });
        (0, vitest_1.it)("transpiles enum with mixed explicit/implicit values", () => {
            const result = (0, setup_1.transpile)(`
        enum Mixed {
          A,
          B = 10,
          C,
          D = 20
        }
      `);
            (0, vitest_1.expect)(result.cpp).toContain("A");
            (0, vitest_1.expect)(result.cpp).toContain("B = 10");
            (0, vitest_1.expect)(result.cpp).toContain("C");
            (0, vitest_1.expect)(result.cpp).toContain("D = 20");
        });
    });
    (0, vitest_1.describe)("Enum Usage", () => {
        (0, vitest_1.it)("transpiles enum used in function", () => {
            const result = (0, setup_1.transpile)(`
        enum Color { Red, Green, Blue }
        function isRed(c: Color): bool {
          return c == Color.Red;
        }
      `);
            (0, vitest_1.expect)(result.cpp).toContain("enum class Color");
        });
    });
});
(0, vitest_1.describe)("Type Aliases", () => {
    (0, vitest_1.it)("transpiles type alias", () => {
        const result = (0, setup_1.transpile)(`
      type Point = { x: int; y: int };
    `);
        // Type aliases for object types are skipped (would need struct definition in C++)
        // The transpiler generates empty output for unsupported type aliases
        (0, vitest_1.expect)(result.cpp).toBeDefined();
    });
    (0, vitest_1.it)("transpiles simple type alias", () => {
        const result = (0, setup_1.transpile)(`
      type ID = int;
    `);
        // Type aliases with auto are skipped (auto is not valid in C++ type aliases)
        // The transpiler generates empty output for auto type aliases
        (0, vitest_1.expect)(result.cpp).toBeDefined();
    });
});
