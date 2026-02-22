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
      // Fields use auto type inference
      expect(result.cpp).toContain("auto x");
      expect(result.cpp).toContain("auto y");
    });

    it("transpiles class with field initializers", () => {
      const result = transpile(`
        class Counter {
          public count: int = 0;
        }
      `);
      // Fields use auto type inference
      expect(result.cpp).toContain("auto count = 0");
    });

    it("transpiles class with private fields", () => {
      const result = transpile(`
        class Secret {
          private value: int;
        }
      `);
      expect(result.cpp).toContain("private:");
      // Fields use auto type inference
      expect(result.cpp).toContain("auto value");
    });

    it("transpiles class with protected fields", () => {
      const result = transpile(`
        class Base {
          protected id: int;
        }
      `);
      expect(result.cpp).toContain("protected:");
      // Fields use auto type inference
      expect(result.cpp).toContain("auto id");
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
      // Method return types use auto inference
      expect(result.cpp).toContain("auto add(int a, int b)");
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
      // Method return types use auto inference
      expect(result.cpp).toContain("auto helper()");
    });

    it("transpiles class with static method", () => {
      const result = transpile(`
        class Factory {
          public static create(): int {
            return 1;
          }
        }
      `);
      // Method return types use auto inference
      expect(result.cpp).toContain("static auto create()");
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
      // Method return types use auto inference
      expect(result.cpp).toContain("auto add(int a, int b)");
      expect(result.cpp).toContain("auto subtract(int a, int b)");
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
      // Method return types use auto inference
      expect(result.cpp).toContain("auto getCount()");
    });

    it("transpiles class with various field types", () => {
      const result = transpile(`
        class Data {
          public intValue: int;
          public floatValue: float;
          public boolValue: bool;
        }
      `);
      // Fields use auto type inference
      expect(result.cpp).toContain("auto intValue");
      expect(result.cpp).toContain("auto floatValue");
      expect(result.cpp).toContain("auto boolValue");
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
    expect(result.cpp).toContain("using Point =");
  });

  it("transpiles simple type alias", () => {
    const result = transpile(`
      type ID = int;
    `);
    // Type aliases use auto type inference
    expect(result.cpp).toContain("using ID = auto");
  });
});