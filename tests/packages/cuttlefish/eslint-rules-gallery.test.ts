// ---------------------------------------------------------------------------
// eslint-rules-gallery.test.ts — the new transpiler ESLint rules.
//
// Each rule added for the ts-patterns gallery findings is exercised on a
// bad sample (must report) and a good sample (must stay quiet), and the
// gallery's own main.ts is asserted clean under the whole ruleset so the
// demo and the rules cannot drift apart.
// ---------------------------------------------------------------------------

import { describe, it } from "vitest";
import { Linter } from "eslint";
import tsParser from "@typescript-eslint/parser";
import * as fs from "node:fs";
import * as path from "path";
import rulesModule from "../../../eslint-transpiler-rules.mjs";

const NEW_RULES = [
  "no-interface-literal-binding",
  "no-set-accessors",
  "no-generic-new-primitive",
  "no-array-returning-function",
  "no-multi-arg-push",
  "no-bare-super-call",
] as const;

function lint(code: string, rules: string[]): number {
  const linter = new Linter({ configType: "flat" });
  const ruleConfig: Record<string, string> = {};
  for (const r of rules) {
    ruleConfig[`tc/${r}`] = "error";
  }
  const messages = linter.verify(code, {
    plugins: {
      tc: { rules: (rulesModule as { rules: Record<string, unknown> }).rules },
    },
    languageOptions: {
      parser: tsParser,
      sourceType: "module",
    },
    rules: ruleConfig,
  });
  return messages.length;
}

describe("transpiler eslint rules — gallery findings", () => {
  it("no-interface-literal-binding fires on annotated literal bindings and returns", () => {
    const bad = `
      interface Point { x: number; y: number; }
      const p: Point = { x: 1, y: 2 };
      function make(): Point { return { x: 1, y: 2 }; }
    `;
    if (lint(bad, ["no-interface-literal-binding"]) !== 2) {
      throw new Error("expected 2 findings (binding + return)");
    }
    const good = `
      interface Point { x: number; y: number; }
      const q = { x: 1, y: 2 };
      const r: Point[] = [];
      function take(p: Point): number { return p.x; }
    `;
    if (lint(good, ["no-interface-literal-binding"]) !== 0) {
      throw new Error("expected no findings for the supported forms");
    }
  });

  it("no-set-accessors fires on setters", () => {
    const bad = `
      class Thermometer {
        private c = 0;
        set celsius(v: number) { this.c = v; }
      }
    `;
    if (lint(bad, ["no-set-accessors"]) !== 1) throw new Error("expected 1 finding");
    const good = `
      class Thermometer {
        private c = 0;
        setCelsius(v: number) { this.c = v; }
      }
    `;
    if (lint(good, ["no-set-accessors"]) !== 0) throw new Error("expected no findings");
  });



  it("no-generic-new-primitive fires on primitive type arguments to new", () => {
    const bad = `
      class Stack<T> { items: T[] = []; }
      const s = new Stack<number>();
    `;
    if (lint(bad, ["no-generic-new-primitive"]) !== 1) throw new Error("expected 1 finding");
    const good = `
      const d = new Date();
      const m = new Map<string, number>();
    `;
    if (lint(good, ["no-generic-new-primitive"]) !== 0) throw new Error("expected no findings");
  });

  it("no-array-returning-function fires on T[] return annotations", () => {
    const bad = `
      function picks(): number[] { return [1, 2]; }
    `;
    if (lint(bad, ["no-array-returning-function"]) !== 1) throw new Error("expected 1 finding");
    const good = `
      function first(): number { return 1; }
      const g = (): string => 'x';
    `;
    if (lint(good, ["no-array-returning-function"]) !== 0) throw new Error("expected no findings");
  });

  it("no-multi-arg-push fires on push with several arguments", () => {
    const bad = `
      const a: number[] = [];
      a.push(1, 2);
    `;
    if (lint(bad, ["no-multi-arg-push"]) !== 1) throw new Error("expected 1 finding");
    const good = `
      const a: number[] = [];
      a.push(1);
    `;
    if (lint(good, ["no-multi-arg-push"]) !== 0) throw new Error("expected no findings");
  });

  it("no-bare-super-call fires on a zero-argument super()", () => {
    const bad = `
      class B { }
      class D extends B {
        constructor() { super(); }
      }
    `;
    if (lint(bad, ["no-bare-super-call"]) !== 1) throw new Error("expected 1 finding");
    const good = `
      class B { constructor(_n: number) {} }
      class D extends B {
        constructor() { super(1); }
      }
    `;
    if (lint(good, ["no-bare-super-call"]) !== 0) throw new Error("expected no findings");
  });

  it("the gallery's main.ts and array-methods.ts are clean under the new rules", () => {
    for (const file of ["main.ts", "array-methods.ts"]) {
      const src = fs.readFileSync(path.join(process.cwd(), "demos", "ts-patterns", "src", file), "utf8");
      const n = lint(src, [...NEW_RULES]);
      if (n !== 0) {
        throw new Error(`${file} has ${n} findings under the new rules — the demo and the rules have drifted`);
      }
    }
  });
});
