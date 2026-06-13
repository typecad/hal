import { describe, expect, it } from "vitest";
import { expectCppContains, expectCppNotContains, transpileArduino, transpileNative } from "./setup";

describe("class reference semantics", () => {
  it("keeps annotated construction and function parameters pointer-consistent", () => {
    const result = transpileNative(`
      class Player {
        public name: string;
        constructor(name: string) { this.name = name; }
      }

      function rename(player: Player, name: string): void {
        player.name = name;
      }

      const player: Player = new Player("Ada");
      rename(player, "Grace");
      console.log(player.name);
    `);

    expectCppContains(result, [
      "void rename(Player* player, std::string name)",
      "Player* player = new Player(\"Ada\")",
      "player->name = name",
      "rename(player, \"Grace\")",
      "player->name",
    ]);
    expectCppNotContains(result, ["Player player = new Player"]);
  });

  it("preserves caller-visible mutation when a class instance is passed", () => {
    const result = transpileNative(`
      class Counter {
        public value: number = 0;
      }

      function increment(counter: Counter): void {
        counter.value += 1;
      }

      const counter = new Counter();
      increment(counter);
      console.log(counter.value);
    `);

    expectCppContains(result, [
      "void increment(Counter* counter)",
      "counter->value += 1",
      "increment(counter)",
    ]);
  });

  it("supports derived instances assigned to base-typed variables", () => {
    const result = transpileNative(`
      class Animal {
        public speak(): string { return "animal"; }
      }

      class Dog extends Animal {
        public override speak(): string { return "dog"; }
      }

      const animal: Animal = new Dog();
      console.log(animal.speak());
    `);

    expectCppContains(result, [
      "virtual std::string speak()",
      "std::string speak() override",
      "Animal* animal = new Dog()",
      "animal->speak()",
    ]);
    expect(result.diagnostics.some((diagnostic) => diagnostic.code === "TS2CPP_POLYMORPHIC_NEW")).toBe(false);
  });

  it("uses class references for return types and arrays", () => {
    const result = transpileNative(`
      class Item {
        public label: string;
        constructor(label: string) { this.label = label; }
      }

      function makeItem(label: string): Item {
        return new Item(label);
      }

      const items: Item[] = [makeItem("one"), new Item("two")];
      console.log(items[1].label);
    `);

    expectCppContains(result, [
      "Item* makeItem(std::string label)",
      "return new Item(label)",
      "std::vector<Item*> items",
      "items[1]->label",
    ]);
  });

  it("supports class references declared later in the source file", () => {
    const result = transpileNative(`
      class Holder {
        public item: Item;
        constructor(item: Item) { this.item = item; }
      }

      class Item {
        public value: number = 1;
      }

      const holder = new Holder(new Item());
      console.log(holder.item.value);
    `);

    expectCppContains(result, [
      "class Item;",
      "Holder(Item* item)",
      "Item* item",
      "holder->item->value",
    ]);
  });

  it("does not treat PascalCase interfaces or enums as class references", () => {
    const result = transpileNative(`
      interface Config { count: number; }
      enum Mode { Off, On }

      function read(config: Config, mode: Mode): number {
        return mode === Mode.On ? config.count : 0;
      }
    `);

    expectCppContains(result, ["read(const Config& config, Mode mode)"]);
    expectCppNotContains(result, ["Config* config", "Mode* mode"]);
  });

  it("tracks string fields and string-returning methods through class references", () => {
    const result = transpileNative(`
      class Player {
        public name: string;
        public level: number;

        constructor(name: string, level: number) {
          this.name = name;
          this.level = level;
        }

        public describe(): string {
          return \`${"${this.name}"} level ${"${this.level}"}\`;
        }
      }

      function greeting(player: Player): string {
        return \`Hello ${"${player.name}"}: ${"${player.describe()}"}\`;
      }

      const player: Player = new Player("Ada", 3);
      console.log(greeting(player));
    `);

    expectCppContains(result, [
      "std::string name",
      "std::string describe()",
      "std::string greeting(Player* player)",
      "player->name",
      "player->describe()",
    ]);
    expectCppNotContains(result, ["Player player = new Player"]);
  });

  it("uses string formatting for class method results on Arduino", () => {
    const result = transpileArduino(`
      class Player {
        public name: string;
        constructor(name: string) { this.name = name; }
        public describe(): string { return \`Player: ${"${this.name}"}\`; }
      }

      function show(player: Player): void {
        console.log(\`Status: ${"${player.describe()}"}\`);
      }

      const player: Player = new Player("Ada");
      show(player);
    `);

    expectCppContains(result, [
      "void show(Player* player)",
      "player->describe().c_str()",
      'snprintf(',
      '"Status: %s"',
    ]);
    expectCppNotContains(result, ["std::to_string(player->describe())"]);
  });
});
