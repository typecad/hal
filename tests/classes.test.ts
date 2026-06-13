import { describe, it } from "vitest";
import { expectCppContains, expectCppNotContains, transpile } from "./setup";

describe("Class Transpilation", () => {
  describe("Basic Class Structure", () => {
    it("transpiles empty class", () => {
      const result = transpile(`
        class Empty {}
      `);
      expectCppContains(result, ["class Empty", "};"]);
    });

    it("transpiles class with public fields", () => {
      const result = transpile(`
        class Point {
          public x: int;
          public y: int;
        }
      `);
      expectCppContains(result, ["class Point", "public:", "int x", "int y"]);
    });

    it("transpiles class with field initializers", () => {
      const result = transpile(`
        class Counter {
          public count: int = 0;
        }
      `);
      expectCppContains(result, ["int count = 0"]);
    });

    it("transpiles class with private fields", () => {
      const result = transpile(`
        class Secret {
          private value: int;
        }
      `);
      expectCppContains(result, ["private:", "int value"]);
    });

    it("transpiles class with protected fields", () => {
      const result = transpile(`
        class Counter {
          protected count: int;
        }
      `);
      expectCppContains(result, ["protected:", "count"]);
    });

    it("transpiles class with mixed visibility fields", () => {
      const result = transpile(`
        class Mixed {
          public a: int;
          private b: int;
          protected c: int;
        }
      `);
      expectCppContains(result, ["public:", "private:", "protected:"]);
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
      expectCppContains(result, ["void greet()"]);
    });

    it("transpiles class with method returning value", () => {
      const result = transpile(`
        class Calculator {
          public add(a: int, b: int): int {
            return a + b;
          }
        }
      `);
      expectCppContains(result, ["int add(int a, int b)"]);
    });

    it("transpiles class with private method", () => {
      const result = transpile(`
        class Secret {
          private helper(): int {
            return 42;
          }
        }
      `);
      expectCppContains(result, ["private:", "int helper()"]);
    });

    it("transpiles class with static method", () => {
      const result = transpile(`
        class Factory {
          public static create(): int {
            return 1;
          }
        }
      `);
      expectCppContains(result, ["static int create()"]);
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
      expectCppContains(result, ["int add(int a, int b)", "int subtract(int a, int b)"]);
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
      expectCppContains(result, ["Point(int x, int y)"]);
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
      expectCppContains(result, ["Item("]);
    });

    it("transpiles super() call to C++ initializer list", () => {
      const result = transpile(`
        class Sensor {
          constructor(id: int) {}
        }
        class SineSensor extends Sensor {
          constructor(id: int, kind: int, unit: int) {
            super(id, kind, unit);
          }
        }
      `);
      expectCppContains(result, ["SineSensor(int id, int kind, int unit) : Sensor(id, kind, unit)"]);
    });

    it("transpiles super() with single argument", () => {
      const result = transpile(`
        class Base {
          constructor(value: int) {}
        }
        class Derived extends Base {
          constructor(value: int) {
            super(value);
          }
        }
      `);
      expectCppContains(result, ["Derived(int value) : Base(value)"]);
    });

    it("does not emit super() call as statement in body", () => {
      const result = transpile(`
        class Sensor {
          constructor(id: int) {}
        }
        class SineSensor extends Sensor {
          constructor(id: int) {
            super(id);
          }
        }
      `);
      expectCppContains(result, ["SineSensor(int id) : Sensor(id) {"]);
      expect(result.cpp).not.toContain("super(");
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
      expectCppContains(result, ["class Counter", "void increment()", "int getCount()"]);
    });

    it("transpiles class with various field types", () => {
      const result = transpile(`
        class Data {
          public intValue: int;
          public floatValue: float;
          public boolValue: bool;
        }
      `);
      expectCppContains(result, ["int intValue", "float floatValue", "bool boolValue"]);
    });
  });

  describe("Pointer Class Fields (new X() initializer)", () => {
    it("transpiles class field with new X() initializer as pointer type", () => {
      const result = transpile(`
        class Engine {
          public power: int = 100;
        }
        class Car {
          public engine: Engine = new Engine();
        }
      `);
      expectCppContains(result, ["Engine* engine = new Engine()"]);
    });

    it("does not assume pointer fields are owned", () => {
      const result = transpile(`
        class Engine {
          public power: int = 100;
        }
        class Car {
          public engine: Engine = new Engine();
        }
      `);
      expectCppNotContains(result, ["~Car()", "delete engine"]);
    });

    it("uses -> for method calls on pointer fields", () => {
      const result = transpile(`
        class Player {
          public health: int = 100;
          public isAlive(): bool {
            return this.health > 0;
          }
        }
        class Game {
          public player: Player = new Player();
          public check(): bool {
            return this.player.isAlive();
          }
        }
      `);
      expect(result.cpp).toContain("this->player->isAlive()");
    });

    it("uses -> for property access on pointer fields", () => {
      const result = transpile(`
        class Player {
          public health: int = 100;
        }
        class Game {
          public player: Player = new Player();
          public getHealth(): int {
            return this.player.health;
          }
        }
      `);
      expect(result.cpp).toContain("this->player->health");
    });

    it("keeps value fields as . access while pointer fields use ->", () => {
      const result = transpile(`
        class Player {
          public health: int = 100;
          public name: string = "Hero";
        }
        class Game {
          public player: Player = new Player();
          public level: int = 1;
          public show(): void {
            const hp = this.player.health;
            const lv = this.level;
          }
        }
      `);
      expect(result.cpp).toContain("this->player->health");
      expect(result.cpp).toContain("this->level");
    });

    it("emits a virtual destructor on a polymorphic base without deleting references", () => {
      const result = transpile(`
        class Base {
          public x: int = 0;
        }
        class Engine {
          public power: int = 100;
        }
        class Derived extends Base {
          public engine: Engine = new Engine();
        }
      `);
      expectCppContains(result, ["virtual ~Base() = default"]);
      expectCppNotContains(result, ["delete engine"]);
    });

    it("promotes field type when new X() is assigned in constructor", () => {
      const result = transpile(`
        class GameState {
          public running: bool = true;
        }
        class GameRunner {
          public state: GameState;
          constructor() {
            this.state = new GameState();
          }
          public check(): bool {
            return this.state.running;
          }
        }
      `);
      expectCppContains(result, ["GameState* state"]);
      expect(result.cpp).toContain("this->state->running");
      expectCppNotContains(result, ["delete state"]);
    });
  });

  describe("Constructor Parameter Pointer Promotion", () => {
    it("promotes field assigned from constructor parameter to pointer", () => {
      const result = transpile(`
        class GameState {
          public running: bool = true;
        }
        class Engine {
          public state: GameState;
          constructor(state: GameState) {
            this.state = state;
          }
        }
      `);
      expectCppContains(result, ["GameState* state"]);
    });

    it("promotes constructor parameter type to pointer", () => {
      const result = transpile(`
        class GameState {
          public running: bool = true;
        }
        class Engine {
          public state: GameState;
          constructor(state: GameState) {
            this.state = state;
          }
        }
      `);
      expect(result.cpp).toMatch(/Engine\s*\(\s*GameState\*\s*state\s*\)/);
    });

    it("uses -> for property access on parameter-promoted field", () => {
      const result = transpile(`
        class GameState {
          public running: bool = true;
        }
        class Engine {
          public state: GameState;
          constructor(state: GameState) {
            this.state = state;
          }
          public check(): bool {
            return this.state.running;
          }
        }
      `);
      expect(result.cpp).toContain("this->state->running");
    });

    it("does not delete borrowed constructor parameters", () => {
      const result = transpile(`
        class GameState {
          public running: bool = true;
        }
        class Engine {
          public state: GameState;
          constructor(state: GameState) {
            this.state = state;
          }
        }
      `);
      expectCppNotContains(result, ["~Engine()", "delete state"]);
    });

    it("does not promote primitive constructor parameters", () => {
      const result = transpile(`
        class Config {
          public value: int;
          constructor(value: int) {
            this.value = value;
          }
        }
      `);
      expect(result.cpp).toMatch(/Config\s*\(\s*int\s+value\s*\)/);
      expect(result.cpp).toContain("int value");
      expect(result.cpp).not.toContain("int*");
    });
  });

  describe("Local Variable Pointer Propagation", () => {
    it("propagates pointer type through let s = this.pointerField", () => {
      const result = transpile(`
        class GameState {
          public running: bool = true;
        }
        class Game {
          public state: GameState = new GameState();
          public check(): bool {
            const s = this.state;
            return s.running;
          }
        }
      `);
      expect(result.cpp).toContain("s->running");
    });
  });

  describe("Deep Access Chains", () => {
    it("uses -> for 3-level deep pointer field chain", () => {
      const result = transpile(`
        class Stats {
          public health: int = 100;
        }
        class Player {
          public stats: Stats = new Stats();
        }
        class Game {
          public player: Player = new Player();
          public getHealth(): int {
            return this.player.stats.health;
          }
        }
      `);
      expect(result.cpp).toContain("this->player->stats->health");
    });

    it("uses -> for 3-level deep pointer field with method call", () => {
      const result = transpile(`
        class Stats {
          public health: int = 100;
          public isAlive(): bool {
            return this.health > 0;
          }
        }
        class Player {
          public stats: Stats = new Stats();
        }
        class Game {
          public player: Player = new Player();
          public check(): bool {
            return this.player.stats.isAlive();
          }
        }
      `);
      expect(result.cpp).toContain("this->player->stats->isAlive()");
    });

    it("uses -> through local variable assigned from deep chain", () => {
      const result = transpile(`
        class Stats {
          public health: int = 100;
        }
        class Player {
          public stats: Stats = new Stats();
        }
        class Game {
          public player: Player = new Player();
          public getHealth(): int {
            const p = this.player;
            return p.stats.health;
          }
        }
      `);
      expect(result.cpp).toContain("p->stats->health");
    });

    it("uses -> for constructor-param field with deep chain", () => {
      const result = transpile(`
        class Stats {
          public health: int = 100;
        }
        class Player {
          public stats: Stats = new Stats();
        }
        class GameState {
          public player: Player = new Player();
        }
        class Engine {
          public state: GameState;
          constructor(state: GameState) {
            this.state = state;
          }
          public getHealth(): int {
            return this.state.player.stats.health;
          }
        }
      `);
      expect(result.cpp).toContain("this->state->player->stats->health");
    });
  });

  describe("Class Methods Calling Free Functions", () => {
    it("supports class methods calling free functions", () => {
      const result = transpile(`
        function double(x: number): number { return x * 2; }

        class Scaler {
          public scale(val: number): number {
            return double(val);
          }
        }

        const s = new Scaler();
        console.log(s.scale(5));
      `);
      expectCppContains(result, [
        "double double(double",
        "class Scaler",
        "return double(val)",
      ]);
    });
  });

  describe("For-Of Loop With Class Arrays", () => {
    it("uses -> for member access on class array iteration variable", () => {
      const result = transpile(`
        class Product { name: string; }
        function test(): void {
          const items: Product[] = [new Product()];
          for (const item of items) { console.log(item.name); }
        }
      `);
      expect(result.cpp).toContain("item->name");
    });
  });
});
