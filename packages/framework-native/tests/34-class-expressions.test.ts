import { describe, done } from '@typecad/expect';

describe("Class expressions")
  .it("class assigned to const then used")
  .expect(
    (() => {
      class MyType {
        value: number;
        constructor(v: number) {
          this.value = v;
        }
      }
      const obj = new MyType(42);
      return obj.value;
    })
  ).toBe(42)
  .it("class with method assigned to const")
  .expect(
    (() => {
      class Greeter {
        greeting: string;
        constructor(msg: string) {
          this.greeting = msg;
        }
        greet(): string {
          return this.greeting;
        }
      }
      const g = new Greeter("hello");
      return g.greet().length;
    })
  ).toBe(5)
  .it("class with computed method")
  .expect(
    (() => {
      class Pair {
        a: number;
        b: number;
        constructor(a: number, b: number) {
          this.a = a;
          this.b = b;
        }
        sum(): number {
          return this.a + this.b;
        }
      }
      const p = new Pair(3, 4);
      return p.sum();
    })
  ).toBe(7)

done();
