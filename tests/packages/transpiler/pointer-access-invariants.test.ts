// ---------------------------------------------------------------------------
// Pointer-access structural invariants.
//
// These tests pin the property that emerged from retiring the post-hoc string
// rewriter `fixPointerFieldAccess` (emit/emitters/top-level-prep.ts). The
// pointer/value access decision is now made once, structurally, on the IR node
// by `expressionToIR` (`resolveExprCppType` + `parsedIsPointer`), and rendered
// faithfully by render-expr.ts. There is no longer any regex that rewrites
// already-rendered C++ text to convert `.` to `->`.
//
// The historical failure mode (demos #15–#23) was a name-based regex on
// rendered text corrupting correct IR. The defining cases:
//
//   - A class VALUE field accessed as `this->field.x` was arrowed to
//     `this->field->x` whenever a same-named POINTER variable existed
//     elsewhere (demo #23 Finding B).
//   - Array mutators on an instance-field receiver emitted `this->__tc_pop`
//     because the receiver-capture regex `(\w+)` stopped at `>` (demo #22 A).
//
// Both produced the corruption patterns these invariants forbid. Any future
// regression that reintroduces a text-based access rewrite will trip them.
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { transpile } from "../../setup";

function transpileNativeSingle(tsCode: string) {
  return transpile(tsCode, { target: "native", emitMode: "single" });
}

/** Forbidden substrings — each is a signature of the retired regex corrupting
 *  structurally-correct IR. Their absence is the invariant. */
const FORBIDDEN_PATTERNS: Array<{ re: RegExp; label: string }> = [
  { re: /->->/, label: "double-arrow `->->` (over-arrowed member chain)" },
  { re: /this->__tc_/, label: "`this->__tc_...` (mutator helper called as a member of this)" },
  // A value field of `this` arrowed by a same-named-pointer collision:
  // `this->heap->` where heap is a value (std::vector/struct) field.
  { re: /this->\w+->(push_back|pop|size|at|count)\b/, label: "`this->field-><container-method>` (value field over-arrowed)" },
];

function assertNoCorruption(tsCode: string, label: string): void {
  const result = transpileNativeSingle(tsCode);
  const out = (result.cpp ?? "") + (result.header ?? "");
  for (const { re, label: what } of FORBIDDEN_PATTERNS) {
    if (re.test(out)) {
      throw new Error(
        `${label}: emitted C++ contains forbidden pattern "${what}" (${re}).\n` +
        `This means a text-based access rewrite is corrupting structurally-correct IR.\n` +
        `--- emitted ---\n${out}`,
      );
    }
  }
}

describe("pointer-access structural invariants (no text-based access rewriting)", () => {
  it("demo #23 shape: class value-field + same-named pointer local does not over-arrow", () => {
    // The defining case. `heap` is both a value field (Job[]) AND a pointer
    // local (MinHeap*). The field access must stay value (`.`); only the
    // standalone local access arrows (`->`).
    assertNoCorruption(`
      interface Job { v: int32_t; }
      class MinHeap {
        private heap: Job[] = [];
        public push(j: Job): void { this.heap.push(j); }
        public n(): int32_t { return this.heap.length; }
        public at(i: int32_t): Job { return this.heap[i]!; }
      }
      export function main(): void {
        const heap: MinHeap = new MinHeap();
        heap.push({ v: 1 });
        const c: int32_t = heap.n();
      }
    `, "demo-23 value-field / pointer-local collision");
  });

  it("demo #22 shape: array mutator on an instance-field receiver is not called as a member of this", () => {
    assertNoCorruption(`
      class Evaluator {
        private ops: string[] = [];
        public pushOp(x: string): void { this.ops.push(x); }
        public popOp(): string { return this.ops.pop()!; }
        public count(): int32_t { return this.ops.length; }
      }
      export function main(): void {
        const e: Evaluator = new Evaluator();
        e.pushOp("+");
        const s: string = e.popOp();
      }
    `, "demo-22 instance-field array mutator");
  });

  it("nested pointer struct field: this->inner.x where inner is a pointer field still arrows correctly", () => {
    // The legitimate case the regex WAS needed for: a pointer-typed field of
    // `this` must still use `->`. This must keep working under the structural
    // path (resolveExprCppType handles `this.field` via classFields lookup).
    const result = transpileNativeSingle(`
      interface Pos { x: int32_t; }
      class Holder {
        private inner: Pos = { x: 0 };
        public getX(): int32_t { return this.inner.x; }
      }
      export function main(): void {
        const h: Holder = new Holder();
        const x: int32_t = h.getX();
      }
    `);
    const out = (result.cpp ?? "") + (result.header ?? "");
    // `inner` is a VALUE field (struct Pos, not Pos*), so it must be `this->inner.x`,
    // not over-arrowed to `this->inner->x`.
    expect(out).toMatch(/this->inner\.x/);
    expect(out).not.toMatch(/this->inner->x/);
  });

  it("standalone pointer local still arrows (heap.method -> heap->method)", () => {
    // The original purpose of the retired global-pointer-var rewrite: a
    // standalone pointer-variable method call must render with `->`. The
    // structural path (resolveExprCppType -> parsedIsPointer) covers this.
    const result = transpileNativeSingle(`
      class C { public size(): int32_t { return 0; } }
      export function main(): void {
        const c: C = new C();
        const n: int32_t = c.size();
      }
    `);
    const out = (result.cpp ?? "") + (result.header ?? "");
    expect(out).toMatch(/c->size\(\)/);
  });

  it("ISR-captured global pointer: assign / property-access / call all arrow (arduino)", () => {
    // The case the deleted output-finalizer.ts file-wide sweep used to patch:
    // a pointer local (`const btn = new Button()`) captured into a hoisted ISR
    // callback, where its type isn't visible at IR-build time. All three access
    // forms must render with `->` via the structural globalPointerVarTypes path
    // now threaded into the renderers — no text sweep.
    const result = transpile(`
      import { D2 } from '@typecad/board-arduino-uno';
      type Handler = () => void;
      class Button {
        private lastPress = 0;
        private handler: Handler | null = null;
        static start(pin: { asInputPullUp(): any; onFalling(handler: () => void): void }): Button {
          const btn = new Button();
          pin.onFalling(() => {
            btn.lastPress = 1;
            if (btn.handler !== null) {
              btn.handler();
            }
          });
          return btn;
        }
        onPress(handler: Handler): this {
          this.handler = handler;
          return this;
        }
      }
      const btn = Button.start(D2).onPress(() => {});
    `, { target: 'arduino' });
    const out = result.cpp ?? "";
    // Assign target, property-access, and call all arrow:
    expect(out).toMatch(/btn->lastPress/);
    expect(out).toMatch(/btn->handler/);
    expect(out).not.toMatch(/btn\.lastPress/);
    expect(out).not.toMatch(/btn\.handler/);
  });
});
