// ---------------------------------------------------------------------------
// broken-patterns-0.test.ts — regressions for the P0/P1 broken-pattern fixes
// from the ts-patterns gallery findings. Each case is differential: the same
// program runs under Node (the JS-semantics oracle) and as
// transpiled→host-g++→native, and must print identical output.
// ---------------------------------------------------------------------------

import { describe, it } from "vitest";
import { runNode, runNative } from "./differential-corpus";
import { transpileNative } from "../../setup";
import { expect } from "vitest";
import * as fs from "node:fs";

const SHIM = [
  "#include <cstdio>",
  "#include <string>",
  'void report(const std::string& s) { std::printf("%s\\n", s.c_str()); }',
  "",
].join("\n");

function diffCase(tag: string, ts: string): void {
  const dir = `.build/broken/${tag}`;
  fs.mkdirSync(dir, { recursive: true });
  const nodeOut = runNode(ts, dir).replace(/\r\n/g, "\n");
  const nativeOut = runNative(ts, dir, tag).replace(/\r\n/g, "\n");
  if (nodeOut !== nativeOut) {
    throw new Error(`${tag}: node=${JSON.stringify(nodeOut)} native=${JSON.stringify(nativeOut)}`);
  }
}

describe("P0 broken-pattern fixes — for...in", () => {
  it("for...in yields indices, not values, over arrays", () => {
    diffCase(
      "for-in",
      `
        declare function report(line: string): void;
        const arr = [10, 20, 30];
        let sumViaKeys = 0;
        for (const i in arr) {
          sumViaKeys += arr[i];
        }
        let keys = '';
        for (const k in arr) {
          keys += (keys === '' ? '' : ',') + k;
        }
        report('sum=' + sumViaKeys + ' keys=' + keys);
      `,
    );
    const out = transpileNative(`
      const arr = [10, 20, 30];
      let n = 0;
      for (const i in arr) { n += arr[i]; }
    `);
    expect(normalize(out.cpp)).toContain("for (long long i = 0;");
    expect(normalize(out.cpp)).toContain(".size()");
  });

  it("for...in without a declaration reports an unsupported diagnostic", () => {
    const out = transpileNative(`
      let k = 0;
      const arr = [1, 2];
      for (k in arr) { k = 0; }
    `);
    const codes = out.diagnostics.map((d: { code: string }) => d.code);
    expect(codes).toContain("TS2CPP_UNSUPPORTED_STMT");
  });
});

function normalize(cpp: string): string {
  return cpp.replace(/\/\/.*/g, "").replace(/\s+/g, " ");
}

describe("P0 broken-pattern fixes — stateful closures", () => {
  it("a lambda that mutates its captured local compiles and counts", () => {
    diffCase(
      "stateful-closure",
      `
        declare function report(line: string): void;
        function makeCounter(start: number): () => number {
          let count = start;
          return () => {
            count += 1;
            return count;
          };
        }
        const tick = makeCounter(10);
        tick();
        tick();
        report('count=' + tick());
      `,
    );
    // The capture must not be promoted to const.
    const out = transpileNative(`
      function makeCounter(start: number): () => number {
        let count = start;
        return () => { count += 1; return count; };
      }
    `);
    expect(out.cpp).not.toMatch(/const .* count = /);
  });
});

describe("P0 broken-pattern fixes — logical operators", () => {
  it("&& / || short-circuit: the left operand's side effects run once", () => {
    diffCase(
      "short-circuit",
      `
        declare function report(line: string): void;
        let evals = 0;
        function counted(v: boolean): boolean {
          evals += 1;
          return v;
        }
        const r1 = counted(false) && counted(true);
        const afterAnd = evals;
        evals = 0;
        const r2 = counted(true) || counted(true);
        report('r1=' + r1 + ' andEvals=' + afterAnd + ' r2=' + r2 + ' orEvals=' + evals);
      `,
    );
  });
  it("value-position && returns the operand (0 || 5 is 5)", () => {
    diffCase(
      "logical-value",
      `
        declare function report(line: string): void;
        report('a=' + (0 || 5) + ' b=' + (1 && 2));
        report('c=' + ('' || 'x'));
      `,
    );
  });
});

describe("P0 broken-pattern fixes — optional call guard", () => {
  it("cb?.() does not invoke an undefined callback", () => {
    diffCase(
      "optional-call",
      `
        declare function report(line: string): void;
        function maybeCall(cb?: (n: number) => void): void {
          cb?.(42);
        }
        function apply(cb: (n: number) => number): number {
          return cb(7);
        }
        maybeCall((n: number): void => {
          report('F callback ran');
        });
        maybeCall(undefined);
        report('apply=' + apply((n: number): number => n + 1));
      `,
    );
  });
});

describe("P1 broken-pattern fixes — interface-annotated literals", () => {
  it("a literal bound to an interface-typed variable allocates and reads correctly", () => {
    diffCase(
      "iface-literal-var",
      `
        declare function report(line: string): void;
        interface Point { x: number; y: number; }
        const p: Point = { x: 3, y: 4 };
        const len = Math.sqrt(p.x * p.x + p.y * p.y);
        report('len=' + len.toFixed(1));
      `,
    );
    const out = transpileNative(`
      interface Point { x: number; y: number; }
      const p: Point = { x: 1, y: 2 };
    `);
    expect(out.cpp).toContain("new Point{");
  });

  it("a member write through an interface-typed binding mutates in place", () => {
    diffCase(
      "iface-literal-mutate",
      `
        declare function report(line: string): void;
        interface Acc { total: number; }
        const a: Acc = { total: 10 };
        a.total += 5;
        report('total=' + a.total);
      `,
    );
  });
});

describe("P2 broken-pattern fixes — optional parameters", () => {
  it("an optional parameter defaults to the type's zero value", () => {
    diffCase(
      "optional-param",
      `
        declare function report(line: string): void;
        function connect(host: string, port?: number): string {
          return port === undefined ? host + ':default' : host + ':' + port;
        }
        report(connect('a'));
        report(connect('b', 8080));
      `,
    );
  });
});

describe("P2 broken-pattern fixes — super() and derived ctors", () => {
  it("a bare super() in a derived ctor no longer crashes the emitter", () => {
    diffCase(
      "bare-super",
      `
        declare function report(line: string): void;
        class Base {
          tag: string;
          constructor(tag: string) { this.tag = tag; }
        }
        class Impl extends Base {
          n: number;
          constructor(tag: string, n: number) {
            super(tag);
            this.n = n;
          }
        }
        const i = new Impl('t', 4);
        report(i.tag + '/' + i.n);
      `,
    );
  });
});

describe("fixed — generic classes", () => {
  it("new Stack<number>() allocates, and instance methods dispatch on the class", () => {
    // The declared type and the new-expression both normalize
    // (<Stack<double>*>, new Stack<double>()), and `.push(...)` on the
    // instance stays a user method (never vector push_back).
    diffCase(
      "generic-dispatch",
      `
        declare function report(line: string): void;
        class Stack<T> {
          items: T[] = [];
          push(v: T): void { this.items.push(v); }
          pop(): T | undefined { return this.items.pop(); }
          get size(): number { return this.items.length; }
        }
        const s = new Stack<number>();
        s.push(1);
        s.push(2);
        // (popping an EMPTY stack is not exercised: JS .pop() yields
        // undefined, which a double-backed vector cannot represent — the
        // native __tc_pop asserts on empty. Documented JS-semantics gap.)
        // Stage through locals: C++ does not define argument evaluation
        // order, so side-effecting calls (pops) never share one template.
        const top = s.pop();
        const next = s.pop();
        const finalSize = s.size;
        report('size=' + finalSize + ' top=' + top + ' next=' + next);
      `,
    );
    const out = transpileNative(`
      class Stack<T> {
        items: T[] = [];
        push(v: T): void { this.items.push(v); }
      }
      const s = new Stack<number>();
    `);
    expect(out.cpp).toContain("Stack<double>* s");
    expect(out.cpp).toContain("new Stack<double>()");
    expect(out.diagnostics.filter(d => d.severity === "error").length).toBe(0);
  });
});

describe("fixed — if(str) statement truthiness", () => {
  it("if (s) guards on emptiness for string conditions", () => {
    diffCase(
      "if-str",
      `
        declare function report(line: string): void;
        function check(s: string): string {
          if (s) { return 'yes'; }
          return 'no';
        }
        report(check('x'));
        report(check(''));
      `,
    );
  });
});

describe("fixed — mixed-type nullish on a number|null param", () => {
  it("(n ?? -1) on a number|null parameter lowers and preserves 0/7", () => {
    diffCase(
      "mixed-nullish",
      `
        declare function report(line: string): void;
        function pick(n: number | null): string {
          return 'v=' + (n ?? -1).toFixed(0); // raw double concat formats differently per tier (README)
        }
        report(pick(7));
        report(pick(null));
      `,
    );
  });
});

describe("fixed — heterogeneous tuples", () => {
  it("a [number, string] tuple allocates as std::tuple and indexes via std::get", () => {
    diffCase(
      "hetero-tuple",
      `
        declare function report(line: string): void;
        const pair: [number, string] = [7, 'seven'];
        report('n=' + pair[0] + ' s=' + pair[1]);
      `,
    );
    const out = transpileNative(`
      declare function report(line: string): void;
      const pair: [number, string] = [7, 'seven'];
      report('n=' + pair[0] + ' s=' + pair[1]);
    `);
    expect(out.cpp).toContain("std::tuple<double, std::string> pair");
    expect(out.cpp).toContain("std::get<0>(pair)");
  });
});

describe("fixed — typeof narrowing over a union", () => {
  it("typeof id === 'number' guards at runtime and narrows each branch", () => {
    diffCase(
      "typeof-narrow",
      `
        declare function report(line: string): void;
        function describeId(id: number | string): string {
          if (typeof id === 'number') { return 'num:' + id.toFixed(0); }
          return 'str:' + id;
        }
        report(describeId(5));
        report(describeId('five'));
      `,
    );
    const out = transpileNative(`
      function describeId(id: number | string): string {
        if (typeof id === 'number') { return 'num:' + id.toFixed(0); }
        return 'str:' + id;
      }
    `);
    expect(out.cpp).toContain("std::holds_alternative<double>(id)");
    expect(out.cpp).toContain("std::get<double>(id)");
    expect(out.cpp).not.toMatch(/if \(false\)/);
  });
});

describe("fixed — destructuring element swap", () => {
  it("[arr[0], arr[1]] = [arr[1], arr[0]] swaps via temps", () => {
    diffCase(
      "elem-swap",
      `
        declare function report(line: string): void;
        const swap = [1, 2];
        [swap[0], swap[1]] = [swap[1], swap[0]];
        report('a=' + swap[0] + ' b=' + swap[1]);
      `,
    );
    const out = transpileNative(`
      const swap = [1, 2];
      [swap[0], swap[1]] = [swap[1], swap[0]];
    `);
    expect(out.cpp).toContain("__swap_");
    expect(out.cpp).toContain("swap[0] = __swap_");
  });
});

describe("fixed — raw double concat formatting", () => {
  it("numeric nullish in a string concat prints JS-style (7, not 7.000000)", () => {
    diffCase(
      "double-concat",
      `
        declare function report(line: string): void;
        function pick(n: number | null): string {
          return 'v=' + (n ?? -1);
        }
        report(pick(7));
        report(pick(null));
      `,
    );
  });
  it("plain double concat stays JS-style", () => {
    diffCase(
      "double-concat-2",
      `
        declare function report(line: string): void;
        const n = 7;
        report('v=' + n);
      `,
    );
  });
});

describe("fixed — cross-function same-name locals (scope poisoning)", () => {
  it("two functions with a local named p of different struct shapes", () => {
    diffCase(
      "scopemap-obj",
      `
        declare function report(line: string): void;
        function a(): void {
          const p = { x: 3, y: 4 };
          report(\`d=\${p.x + p.y}\`);
        }
        function b(): void {
          const p = { x: 'ex', y: 'why' };
          report(\`j=\${p.x + p.y}\`);
        }
        a();
        b();
      `,
    );
  });
  it("two functions with a local named m of different Map types", () => {
    diffCase(
      "scopemap-map",
      `
        declare function report(line: string): void;
        function a(): void {
          const m = new Map<string, number>();
          m.set('k', 5);
          report(\`v=\${m.get('k')}\`);
        }
        function b(): void {
          const m = new Map<number, string>();
          m.set(1, 'one');
          report(\`v=\${m.get(1)}\`);
        }
        a();
        b();
      `,
    );
  });
});

describe("fixed — scope shadowing, hard shapes", () => {
  it("same-name struct locals in two class methods", () => {
    diffCase(
      "method-structs",
      `
        declare function report(line: string): void;
        class Rig {
          one(): void {
            const p = { x: 3, y: 4 };
            report(\`n=\${p.x + p.y}\`);
          }
          two(): void {
            const p = { x: 'ex', y: 'why' };
            report(\`s=\${p.x + p.y}\`);
          }
        }
        const r = new Rig();
        r.one();
        r.two();
      `,
    );
  });
  it("shadowed struct local in a nested block", () => {
    diffCase(
      "block-struct-shadow",
      `
        declare function report(line: string): void;
        function run(): void {
          const p = { x: 1, y: 2 };
          if (true) {
            const p = { x: 'a', y: 'b' };
            report('in=' + p.x + p.y);
          }
          report('out=' + (p.x + p.y));
        }
        run();
      `,
    );
  });
  it("same-name Map locals in nested scopes", () => {
    diffCase(
      "block-map-shadow",
      `
        declare function report(line: string): void;
        function run(): void {
          const m = new Map<string, number>();
          m.set('k', 5);
          if (true) {
            const m = new Map<number, string>();
            m.set(1, 'one');
            report('in=' + m.get(1));
          }
          report('out=' + m.get('k'));
        }
        run();
      `,
    );
  });
  it("same-name struct locals in sibling top-level blocks", () => {
    diffCase(
      "sibling-structs",
      `
        declare function report(line: string): void;
        function run(flag: boolean): void {
          if (flag) {
            const p = { v: 10 };
            report('a=' + p.v);
          } else {
            const p = { v: 'ten' };
            report('b=' + p.v);
          }
        }
        run(true);
        run(false);
      `,
    );
  });
});

describe("fixed — else-branch and fall-through variant narrowing", () => {
  it("early-return typeof guard narrows the fall-through to the complement arm", () => {
    diffCase(
      "else-str-arm",
      `
        declare function report(line: string): void;
        function describeId(id: number | string): string {
          if (typeof id === 'number') {
            return 'num:' + id.toFixed(0);
          }
          return 'str:' + id.toUpperCase();
        }
        report(describeId(5));
        report(describeId('five'));
      `,
    );
  });
  it("string-arm guard narrows the fall-through to the numeric arm", () => {
    diffCase(
      "else-num-arm",
      `
        declare function report(line: string): void;
        function describeId(id: number | string): string {
          if (typeof id === 'string') {
            return 'str:' + id;
          }
          return 'num:' + (id * 2).toFixed(0);
        }
        report(describeId(5));
        report(describeId('five'));
      `,
    );
  });
  it("explicit else narrows; statements after the if see the whole variant", () => {
    diffCase(
      "post-if-whole",
      `
        declare function report(line: string): void;
        function run(id: number | string): void {
          if (typeof id === 'number') {
            report('num:' + id.toFixed(0));
          } else {
            report('str:' + id.toUpperCase());
          }
          report('after:' + describeAfter(id));
        }
        function describeAfter(id: number | string): string {
          return 'whole';
        }
        run(5);
        run('five');
      `,
    );
  });
});
