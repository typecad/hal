// ---------------------------------------------------------------------------
// Demo #23 regressions — a transpilation gap surfaced by a small, idiomatic
// binary-min-heap priority-queue demo. Now FIXED in the transpiler; this
// file pins the behavior.
//
//   B — A class value-field accessed as `this-><field>.<member>` inside a
//       class method was wrongly rewritten to `this-><field>-><member>`
//       (arrow on a non-pointer field), producing the g++ error
//       "base operand of '->' has non-pointer type 'std::vector<...>'",
//       WHENEVER a pointer-typed variable of the SAME NAME existed elsewhere
//       in the program.
//
//       Root cause: `fixPointerFieldAccess` (assigned in
//       `emit/emitters/top-level-prep.ts`) walked `globalPointerVarTypes`
//       with a `\b${varName}\.` regex. The `\b` word boundary also matches
//       between the `->` and the name in a member-access chain, so a class
//       field `this->heap` was arrowed to `this->heap->` whenever a pointer
//       variable `heap` (e.g. `const heap: MinHeap = new MinHeap()` in a
//       sibling function) existed. The name-based rewrite could not
//       distinguish the pointer VARIABLE `heap` from a same-named class
//       FIELD reached through `this->heap`.
//
//       This corrupted every method call (`this.heap.push`,
//       `this.heap.pop`) and length read (`this.heap.length`,
//       `this.heap.length - 1`) on the field inside the class, because the
//       calleeTransformer (`fixPointerFieldAccess`, threaded through
//       `statement-renderer.ts` `renderCall`) blanket-converted the
//       post-field `.` to `->`. The `pointerStructFields` loop in the SAME
//       function already used a `(^|[^>])` guard and was unaffected — only
//       the global-pointer-var loop used the unguarded `\b` form.
//
//       Fix: the global-pointer-var loop now uses the same
//       `(^|[^>.])${varName}\.` guard, so `this->heap.x` / `obj->heap.x`
//       (preceded by `>`) and `a.heap.x` (preceded by `.`) are left alone;
//       only a standalone `heap.x` (start-of-string or preceded by a
//       non-`.`/non-`>` char) is rewritten to `heap->x`.
//
// Why this is hard to trigger by accident: it requires a NAME COLLISION
// between a class value-field and a pointer variable of the same name. The
// demo's `MinHeap` field `heap` collided with `main()`'s local
// `const heap: MinHeap = new MinHeap()` (a pointer, since `new C()` → `C*`).
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { transpile } from "../../setup";

function transpileNativeSingle(tsCode: string) {
  return transpile(tsCode, { target: "native", emitMode: "single" });
}

// The minimal trigger: a class with a value field `heap`, AND a sibling
// function holding a pointer variable also named `heap`. Before the fix,
// `this->heap.push` was rewritten to `this->heap->push` inside the class.

describe("B: class value-field not arrowed due to a same-named pointer variable", () => {
  it("keeps this.heap.push (method call) as this->heap.push_back, not this->heap->push", () => {
    const result = transpileNativeSingle(`
      interface Job { v: int32_t; }
      class MinHeap {
        private heap: Job[] = [];
        public push(j: Job): void {
          this.heap.push(j);
        }
      }
      export function main(): void {
        // Same-named pointer variable in a sibling scope — the trigger.
        const heap: MinHeap = new MinHeap();
        heap.push({ v: 1 });
      }
    `);
    const out = (result.cpp ?? "") + (result.header ?? "");
    // The field access must keep the dot before the method (push_back via
    // the RECV rewrite), NOT become this->heap->push.
    expect(out).toMatch(/this->heap\.push_back\(j\)/);
    expect(out).not.toMatch(/this->heap->push/);
  });

  it("keeps this.heap.pop() as __tc_pop(this->heap), not __tc_pop on this->heap->", () => {
    const result = transpileNativeSingle(`
      interface Job { v: int32_t; }
      class MinHeap {
        private heap: Job[] = [];
        public pop(): Job {
          const last: Job = this.heap.pop()!;
          return last;
        }
      }
      export function main(): void {
        const heap: MinHeap = new MinHeap();
        const x: Job = heap.pop();
      }
    `);
    const out = (result.cpp ?? "") + (result.header ?? "");
    expect(out).toMatch(/__tc_pop\(this->heap\)/);
    expect(out).not.toMatch(/this->heap->pop/);
  });

  it("keeps this.heap.length as this->heap.size(), not this->heap->size()", () => {
    const result = transpileNativeSingle(`
      interface Job { v: int32_t; }
      class MinHeap {
        private heap: Job[] = [];
        public n(): int32_t {
          const count: int32_t = this.heap.length;
          return count;
        }
      }
      export function main(): void {
        const heap: MinHeap = new MinHeap();
        const c: int32_t = heap.n();
      }
    `);
    const out = (result.cpp ?? "") + (result.header ?? "");
    expect(out).toMatch(/this->heap\.size\(\)/);
    expect(out).not.toMatch(/this->heap->size/);
  });

  it("keeps this.heap[i] indexed access as this->heap[i], not this->heap->[i]", () => {
    const result = transpileNativeSingle(`
      interface Job { v: int32_t; }
      class MinHeap {
        private heap: Job[] = [];
        public at(i: int32_t): Job {
          const j: Job = this.heap[i]!;
          return j;
        }
      }
      export function main(): void {
        const heap: MinHeap = new MinHeap();
      }
    `);
    const out = (result.cpp ?? "") + (result.header ?? "");
    expect(out).toMatch(/this->heap\[i\]/);
    expect(out).not.toMatch(/this->heap->\[/);
  });

  it("still rewrites a STANDALONE pointer-variable method call (heap.method -> heap->method)", () => {
    // Regression guard: the fix must not break the original purpose of the
    // global-pointer-var rewrite — a standalone `heap.push` (the pointer
    // variable itself, not a same-named field) must still become `heap->push`.
    const result = transpileNativeSingle(`
      class MinHeap {
        public size(): int32_t { return 0; }
      }
      export function main(): void {
        const heap: MinHeap = new MinHeap();
        const n: int32_t = heap.size();
      }
    `);
    const out = (result.cpp ?? "") + (result.header ?? "");
    // `heap.size()` in main() must use -> (heap is a MinHeap* pointer).
    expect(out).toMatch(/heap->size\(\)/);
  });
});
