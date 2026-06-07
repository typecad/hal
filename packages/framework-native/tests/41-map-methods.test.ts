import { describe, done } from '@typecad/expect';

describe("Map methods")
  .it("map set and get via bracket operator")
  .expect(
    (() => {
      class Store {
        items: Map<string, number>;
        constructor() {
          this.items = new Map();
        }
        addItem(key: string, val: number): void {
          this.items.set(key, val);
        }
        getItem(key: string): number {
          return this.items.get(key);
        }
      }
      const s = new Store();
      s.addItem("a", 10);
      s.addItem("b", 20);
      return s.getItem("a") + s.getItem("b");
    })
  ).toBe(30)

  .it("map has via count")
  .expect(
    (() => {
      class Registry {
        entries: Map<string, number>;
        constructor() {
          this.entries = new Map();
        }
        register(name: string, val: number): void {
          this.entries.set(name, val);
        }
        exists(name: string): boolean {
          return this.entries.has(name);
        }
      }
      const r = new Registry();
      r.register("x", 1);
      const found = r.exists("x");
      return found ? 1 : 0;
    })
  ).toBe(1)

done();
