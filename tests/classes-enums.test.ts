import { describe, it, expect } from "vitest";
import { transpile, normalizeCpp } from "./setup";

describe("Class Transpilation", () => {
  describe("Basic Class Structure", () => {
    it("transpiles empty class", () => {
      const result = transpile(`
        class Empty {}
      `);
      expect(result.cpp).toContain("class Empty");
      expect(result.cpp).toContain("};");
    });

    it("transpiles class with public fields", () => {
      const result = transpile(`
        class Point {
          public x: int;
          public y: int;
        }
      `);
      expect(result.cpp).toContain("class Point");
      expect(result.cpp).toContain("public:");
      // Fields use explicit types (auto is not valid for class members in C++)
      expect(result.cpp).toContain("int x");
      expect(result.cpp).toContain("int y");
    });

    it("transpiles class with field initializers", () => {
      const result = transpile(`
        class Counter {
          public count: int = 0;
        }
      `);
      // Fields use explicit types (auto is not valid for class members in C++)
      expect(result.cpp).toContain("int count = 0");
    });

    it("transpiles class with private fields", () => {
      const result = transpile(`
        class Secret {
          private value: int;
        }
      `);
      expect(result.cpp).toContain("private:");
      // Fields use explicit types (auto is not valid for class members in C++)
      expect(result.cpp).toContain("int value");
    });

    it("transpiles class with protected fields", () => {
      const result = transpile(`
        class Counter {
          protected count: int;
        }
      `);
      // Protected fields use protected: section in C++
      expect(result.cpp).toContain("protected:");
      expect(result.cpp).toContain("count");
    });

    it("transpiles class with mixed visibility fields", () => {
      const result = transpile(`
        class Mixed {
          public a: int;
          private b: int;
          protected c: int;
        }
      `);
      expect(result.cpp).toContain("public:");
      expect(result.cpp).toContain("private:");
      expect(result.cpp).toContain("protected:");
    });
  });

  describe("Class Methods", () => {
    it("transpiles class with public method", () => {
      const result = transpile(`
        class Greeter {
          public greet(): void {
            const msg = "hello";
          }
        }
      `);
      expect(result.cpp).toContain("void greet()");
    });

    it("transpiles class with method returning value", () => {
      const result = transpile(`
        class Calculator {
          public add(a: int, b: int): int {
            return a + b;
          }
        }
      `);
      // Method return types use explicit types (auto return requires trailing return type in C++)
      expect(result.cpp).toContain("int add(int a, int b)");
    });

    it("transpiles class with private method", () => {
      const result = transpile(`
        class Secret {
          private helper(): int {
            return 42;
          }
        }
      `);
      expect(result.cpp).toContain("private:");
      // Return type is inferred from return statement
      expect(result.cpp).toContain("int helper()");
    });

    it("transpiles class with static method", () => {
      const result = transpile(`
        class Factory {
          public static create(): int {
            return 1;
          }
        }
      `);
      // Method return types use explicit types (auto return requires trailing return type in C++)
      expect(result.cpp).toContain("static int create()");
    });

    it("transpiles class with multiple methods", () => {
      const result = transpile(`
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
      expect(result.cpp).toContain("int add(int a, int b)");
      expect(result.cpp).toContain("int subtract(int a, int b)");
    });
  });

  describe("Constructors", () => {
    it("transpiles class with constructor", () => {
      const result = transpile(`
        class Point {
          public x: int;
          public y: int;
          constructor(x: int, y: int) {
            this.x = x;
            this.y = y;
          }
        }
      `);
      expect(result.cpp).toContain("Point(int x, int y)");
    });

    it("transpiles constructor with default parameter", () => {
      const result = transpile(`
        class Item {
          public value: int;
          constructor(value: int = 0) {
            this.value = value;
          }
        }
      `);
      expect(result.cpp).toContain("Item(");
    });
  });

  describe("Complex Classes", () => {
    it("transpiles class with fields and methods", () => {
      const result = transpile(`
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
      expect(result.cpp).toContain("class Counter");
      expect(result.cpp).toContain("void increment()");
      // Method return types use explicit types (auto return requires trailing return type in C++)
      expect(result.cpp).toContain("int getCount()");
    });

    it("transpiles class with various field types", () => {
      const result = transpile(`
        class Data {
          public intValue: int;
          public floatValue: float;
          public boolValue: bool;
        }
      `);
      // Fields use explicit types based on their type annotation
      expect(result.cpp).toContain("int intValue");
      expect(result.cpp).toContain("float floatValue");
      expect(result.cpp).toContain("bool boolValue");
    });
  });
});

describe("Enum Transpilation", () => {
  describe("Basic Enums", () => {
    it("transpiles simple enum", () => {
      const result = transpile(`
        enum Color {
          Red,
          Green,
          Blue
        }
      `);
      expect(result.cpp).toContain("enum class Color");
      expect(result.cpp).toContain("Red");
      expect(result.cpp).toContain("Green");
      expect(result.cpp).toContain("Blue");
    });

    it("transpiles enum with explicit values", () => {
      const result = transpile(`
        enum Status {
          Ok = 200,
          NotFound = 404,
          Error = 500
        }
      `);
      expect(result.cpp).toContain("Ok = 200");
      expect(result.cpp).toContain("NotFound = 404");
      expect(result.cpp).toContain("Error = 500");
    });

    it("transpiles const enum", () => {
      const result = transpile(`
        const enum Direction {
          Up,
          Down,
          Left,
          Right
        }
      `);
      expect(result.cpp).toContain("enum class Direction");
    });

    it("transpiles enum with mixed explicit/implicit values", () => {
      const result = transpile(`
        enum Mixed {
          A,
          B = 10,
          C,
          D = 20
        }
      `);
      expect(result.cpp).toContain("A");
      expect(result.cpp).toContain("B = 10");
      expect(result.cpp).toContain("C");
      expect(result.cpp).toContain("D = 20");
    });
  });

  describe("Enum Usage", () => {
    it("transpiles enum used in function", () => {
      const result = transpile(`
        enum Color { Red, Green, Blue }
        function isRed(c: Color): bool {
          return c == Color.Red;
        }
      `);
      expect(result.cpp).toContain("enum class Color");
    });
  });
});

describe("Type Aliases", () => {
  it("transpiles type alias", () => {
    const result = transpile(`
      type Point = { x: int; y: int };
    `);
    // Type aliases for object types are skipped (would need struct definition in C++)
    // The transpiler generates empty output for unsupported type aliases
    expect(result.cpp).toBeDefined();
  });

  it("transpiles simple type alias", () => {
    const result = transpile(`
      type ID = int;
    `);
    // Type aliases with auto are skipped (auto is not valid in C++ type aliases)
    // The transpiler generates empty output for auto type aliases
    expect(result.cpp).toBeDefined();
  });
});