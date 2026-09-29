// ---------------------------------------------------------------------------
// Regression tests — transpiler fixes surfaced by the zephyr-sentence-router
// demo (a UART NMEA-style sentence decoder: checksum + split parsing, a
// polymorphic Field hierarchy with super calls, string enums as types,
// Record lookups with template-literal keys, StaticArray/vector joins, and
// the entry TU's hardware shims under the shared shim guard). Each block
// pins one formerly broken lowering:
//
//   1. String slice after lastIndexOf on the SAME string local lowers as a
//      STRING method (`__tc_slice2`), not "array.slice unsupported".
//   2. super.method() inside an override lowers to `Base::method()`
//      (expression, statement, and property forms).
//   3. `.join(sep)` lowers on both receiver shapes: push-built locals
//      (`__tc_StaticArray::join` member) and loop-pushed locals routed to
//      std::vector (`__tc_join` helper).
//   4. A string enum used as a TYPE (method return, getter, local) maps to
//      std::string — same file and imported cross-file.
//   5. A quoted Record key contributes its UNQUOTED text and string-keyed
//      maps quote initializer keys (`NAMES["3"]`, never `NAMES["'3'"]` or a
//      bare double key).
//   6. A template-literal key on a string-keyed map converts to a string
//      (`__tc_numToStr_js`), never a bare double subscript.
//   7. `this->getterProp` inside raw text never mangles to `this_->getX()`.
//   8. Method calls chained on `new X(...)` parenthesize and arrow:
//      `(new X(...))->m()`.
//   9. char element reads returned from std::string functions wrap:
//      `std::string(1, s[i])`.
//  10. Hardware shims survive a module header defining the shared shim
//      guard first (UART/GPIO blocks hoisted out of CUTTLEFISH_SHIM_DEFINED).
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { transpile } from "../../setup";
import { ZephyrStrategy } from "../../../packages/framework-zephyr/src/strategy";

const zephyr = () => new ZephyrStrategy();

describe("sentence-router demo findings (Zephyr)", () => {
  it("string slice after lastIndexOf lowers as a string method", () => {
    const out = transpile(`
      export function probe(line: string): string {
        const t = line.trim();
        const star = t.lastIndexOf('*');
        const body = t.slice(1, star);
        return body;
      }
      while (true) {}
    `, { strategy: zephyr(), target: 'zephyr' });
    expect(out.diagnostics.filter(d => d.severity === 'error')).toHaveLength(0);
    expect(out.cpp).toMatch(/__tc_slice2\(t, 1, star\)/);
    expect(out.cpp).not.toMatch(/array\.slice unsupported/);
  });

  it("super.method() inside an override lowers to a base-qualified call", () => {
    const out = transpile(`
      class Base {
        protected _raw: string = 'x';
        render(): string { return this._raw; }
      }
      class Sub extends Base {
        render(): string {
          const t = super.render();
          return t.length > 0 ? t.toUpperCase() : '?';
        }
        reset(): void { super.render(); }
      }
      const s = new Sub();
      let sink = '';
      sink = s.render();
      while (true) {}
    `, { strategy: zephyr(), target: 'zephyr' });
    expect(out.diagnostics.filter(d => d.severity === 'error')).toHaveLength(0);
    expect(out.cpp).toMatch(/Base::render\(\)/);
    expect(out.cpp).not.toMatch(/0 \/\* unsupported_expr \*\//);
  });

  it("join lowers on push-built locals (StaticArray member) and loop-pushed locals (vector helper)", () => {
    const out = transpile(`
      export function a(): string {
        const lines: string[] = [];
        lines.push('x');
        lines.push('y');
        return lines.join(' | ');
      }
      export function b(keys: string[]): string {
        const ids: string[] = [];
        for (const k of keys) { ids.push(k); }
        return ids.join(',');
      }
      while (true) {}
    `, { strategy: zephyr(), target: 'zephyr' });
    expect(out.diagnostics.filter(d => d.code === 'array-join-unsupported')).toHaveLength(0);
    expect(out.cpp).toMatch(/\)\.join\(" \| "\)/);
    expect(out.cpp).toMatch(/__tc_join\(ids, ","\)/);
  });

  it("a string enum used as a type maps to std::string (same file and imported)", () => {
    const out = transpile(`
      export enum Phase { Idle = 'IDLE', Sync = 'SYNC' }
      export class Link {
        private _p: Phase = Phase.Idle;
        get phase(): Phase { return this._p; }
        current(): Phase { return this._p; }
      }
      const l = new Link();
      let sink: Phase = l.current();
      while (true) {}
    `, { strategy: zephyr(), target: 'zephyr' });
    expect(out.cpp).toMatch(/std::string getPhase\(\)/);
    expect(out.cpp).toMatch(/std::string current\(\)/);
    expect(out.cpp).not.toMatch(/Phase getPhase/);
    expect(out.cpp).not.toMatch(/Phase current/);
  });

  it("quoted Record keys unquote and string-keyed maps quote initializer keys", () => {
    const out = transpile(`
      const NAMES: Record<string, string> = { '3': 'three', ab: 'x' };
      export function lookup(): string { return NAMES['3']; }
      while (true) {}
    `, { strategy: zephyr(), target: 'zephyr' });
    expect(out.cpp).toMatch(/NAMES\["3"\]/);
    expect(out.cpp).not.toMatch(/NAMES\["'3'"\]/);
    expect(out.cpp).not.toMatch(/NAMES\[3\]/);
  });

  it("a template-literal map key converts to a string, not a double subscript", () => {
    const out = transpile(`
      const NAMES: Record<string, string> = { '3': 'three' };
      export function lookup(code: number): string {
        return NAMES[\`\${code}\`] ?? 'none';
      }
      while (true) {}
    `, { strategy: zephyr(), target: 'zephyr' });
    expect(out.cpp).toMatch(/NAMES\[__tc_numToStr_js\(code\)\]/);
    expect(out.cpp).not.toMatch(/NAMES\[code\]/);
  });

  it("this->getterProp in raw text does not mangle to this_", () => {
    const out = transpile(`
      class Scaled {
        private _v: number = 3;
        get value(): number { return this._v; }
        render(): string { return this.value.toFixed(2); }
        weight(): number { return Math.round(Math.abs(this.value)); }
      }
      const s = new Scaled(3);
      let sink = '';
      sink = s.render();
      while (true) {}
    `, { strategy: zephyr(), target: 'zephyr' });
    expect(out.cpp).not.toMatch(/this_/);
    expect(out.cpp).toMatch(/this->getValue\(\)/);
  });

  it("method calls chained on new expressions parenthesize and arrow", () => {
    const out = transpile(`
      class Line {
        text(): string { return 'a'; }
      }
      export function mk(): string {
        const lines: string[] = [];
        lines.push(new Line().text());
        return lines.join(' | ');
      }
      while (true) {}
    `, { strategy: zephyr(), target: 'zephyr' });
    expect(out.cpp).toMatch(/\(new Line\(\)\)->text\(\)/);
    expect(out.cpp).not.toMatch(/new Line\(\)\.text/);
  });

  it("char element reads returned from string functions wrap in std::string(1, c)", () => {
    const out = transpile(`
      const PRINTABLE = 'abcdef';
      export function charOf(b: number): string {
        return PRINTABLE[b];
      }
      while (true) {}
    `, { strategy: zephyr(), target: 'zephyr' });
    expect(out.cpp).toMatch(/return std::string\(1, PRINTABLE\[/);
  });
});
