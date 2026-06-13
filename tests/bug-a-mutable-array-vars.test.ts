import { describe, it, expect } from "vitest";
import { transpile, transpileNative } from "./setup";

describe("Bug A: mutableArrayVars survives class processing", () => {
  it("promotes array to StaticArray even when class appears before variable", () => {
    const result = transpile(`
      class Item {
        public value: number;
        constructor(v: number) { this.value = v; }
      }
      let items: number[] = [];
      items.push(1);
      items.push(2);
      console.log(items[0]);
    `);
    expect(result.cpp).toContain("__tc_StaticArray<double");
  });

  it("forces let storage on const array with push when class precedes it", () => {
    const result = transpile(`
      class Helper {
        public doWork(): void { console.log("working"); }
      }
      const data: number[] = [];
      data.push(42);
    `);
    expect(result.cpp).not.toMatch(/const\s+__tc_StaticArray<int,\s*2>\s+data/);
  });

  it("stores class references in arrays without copying the instance", () => {
    const result = transpileNative(`
      class Item {
        public value: number;
        constructor(v: number) { this.value = v; }
      }
      let items: Item[] = [];
      items.push(new Item(42));
      console.log(items[0]!.value);
    `);
    expect(result.cpp).toContain("std::vector<Item*> items");
    expect(result.cpp).toContain("items.push_back(new Item(42))");
    expect(result.cpp).toContain("items[0]->value");
    expect(result.cpp).not.toContain("*(new Item(42))");
  });
});
