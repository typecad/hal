# Priority-queue job scheduler — cuttlefish demo #23

A **mid-complexity, idiomatic TypeScript** program implementing a **binary
min-heap** that schedules jobs by priority. Jobs are inserted with an
integer priority (lower = sooner) and a small payload, then drained in
priority order. Transpiled to C++ by cuttlefish
(`@typecad/framework-native`).

This is the **twenty-third** demo iteration. Like #15–#22 it is deliberately
**readable** — real, everyday TypeScript — and is **not** a
feature-exhaustion test. It is a single self-contained `main.ts`. It
deliberately picks a **different data shape** from #15–#22:

- a **`class MinHeap`** that owns a **`Job[]` instance field** and does
  heavy **indexed array read / write / swap** on `this.heap[i]`
  (`swap`, `siftUp`, `siftDown`, parent/child index arithmetic),
- **struct mutation through an array index** (`this.heap[i] = tmp`),
- a **`Map<string, int32_t>` per-kind cost table** keyed by a short tag,
  with `.has`-guarded `.get` (the idiomatic keyed-table shape),
- a **`const enum JobKind`** + a **`switch`** on it (numeric enum
  dispatch — re-exercises §1.7/§2.4 in a different context than #22),
- module-scope free functions called from class methods, a `while` loop
  with `break`, `Math.min` / `Math.max`, and template literals interpolating
  struct fields.

The first compile attempt surfaced **two real issues** (Findings A and B).
**Finding B is a genuine transpiler bug** — a name collision between a class
value-field and a same-named pointer variable — now **FIXED** in the
transpiler and pinned by `tests/packages/transpiler/demo-23-regressions.test.ts`
(5 tests). **Finding A is a TypeScript-level author pitfall** (not a
transpiler gap), corrected in the source. The previous iteration (#22,
infix→RPN shunting-yard) is preserved in `demo22-backup/`.

## Running

```bash
npm run lint      # ESLint with the cuttlefish transpiler-rules plugin
npm run compile   # transpile TS -> C++ and compile with g++
# binary lands in demo/src/out/.build/main.exe
```

- **`npm run lint` exits 0** with no warnings.
- **`npm run compile` exits 0**. `g++` emits no errors and no warnings.
  The transpiler emits no diagnostics.
- When `g++` *does* emit errors they are surfaced verbatim and mapped back
  to TypeScript source spans — that is exactly how Finding B was discovered
  on the first compile attempt.

## Sample output

```
--- loading ---
loaded 6 jobs
--- draining (priority order) ---
#1 [ALARM] pri=1 cost=50 over-temp!
#3 [HOUSE] pri=1 cost=3 gc sweep
#4 [LOG] pri=2 cost=1 link up
#2 [LOG] pri=3 cost=1 boot complete
#0 [TELE] pri=5 cost=5 read sensors
#5 [TELE] pri=5 cost=5 read sensors (2)
--- summary ---
drained 6 jobs; pri range [1 .. 5]
done
```

Verified by hand — the heap orders on `(priority, seq)`:

- **pri 1** → `#1` (ALARM, seq 1) before `#3` (HOUSE, seq 3) ✓
- **pri 2** → `#4` (LOG) ✓
- **pri 3** → `#2` (LOG) ✓
- **pri 5** → `#0` (TELE, seq 0) before `#5` (TELE, seq 5) ✓
- per-kind costs (`ALARM=50`, `HOUSE=3`, `LOG=1`, `TELE=5`) match `COST` ✓

## What the source exercises

Idiomatic patterns that lower cleanly (all confirmed by this demo's clean
compile):

- §1.2  `int32_t`; `boolean` → `bool`; `string` → `std::string`
- §1.5  `Job[]` → `std::vector<Job>`; indexed read/write on a member
        receiver (`this->heap[i]`, `this->heap[i] = tmp`); `.push`/`.pop`
        on a member receiver; `Map<string,int32_t>` → `std::map`;
        `Map.has` → `.count(k) > 0`; `Map.get(k)!` → `.at(k)`
- §1.6  `interface Job` → value-typed `struct Job`; struct literal
        `{ priority, kind, label, seq }` → brace-init
- §1.7  `const enum JobKind` (inlined); enum equality comparison
- §1.4  template literals interpolating top-level `const std::string` and
        struct fields (`job.seq`, `job.priority`, `job.label`, etc.)
- §2.4  numeric `switch` on a `const enum` (plain comparison, no
        `std::string(...)` wrap)
- §2.2  `while (true)` with `break`; C-style `for (let i; i < n; i = i+1)`
- §5.1  `Math.min` / `Math.max` → ternary chains
- §3.1  module-scope free functions (`kindTag`, `costFor`, `comesBefore`,
        `formatJob`)
- §4.1  `class MinHeap` with private `Job[]` + `int32_t` fields + initializers
- §4.2  `this.heap` / `this.counter` read/write → `this->...`
- §4.3  class methods calling module-scope free functions (`comesBefore`)
- §4.5  `new MinHeap()` → pointer

---

# Transpilation issues found by Demo #23

Demo #23 was written in its natural idiomatic shape. The **first**
`npm run compile` surfaced one TypeScript-level author pitfall (Finding A)
and, after that was corrected, one **hard `g++` error** from a genuine
transpiler bug (Finding B). **Finding B is now FIXED** in the transpiler
source and pinned by a regression test. The source is in its fully
idiomatic shape (no workarounds).

## Finding A — `Record<K,V>` has no `.has()` (TypeScript-level pitfall, corrected in source)

The natural first draft of the cost table was a `Record<string, int32_t>`
looked up with `.has`:

```ts
let COST: Record<string, int32_t> = {};
function costFor(kind: JobKind): int32_t {
  if (!COST.has(tag)) { return 0; }   // ← COST.has does not exist
  return COST[tag];
}
```

This is a **TypeScript type error** (caught by the cuttlefish type-checker
before any transpilation), not a transpiler gap:

```
ERROR: src\main.ts(92,8): 'COST.has' is possibly 'undefined'.
ERROR: src\main.ts(92,13): This expression is not callable.
  Type 'Number' has no call signatures.
ERROR: src\main.ts(95,3): Type 'number | undefined' is not assignable to type 'number'.
```

**Why:** a `Record<K,V>` is, at the TypeScript level, a *plain indexed
object* — `.has()` is a `Map` API, not an object API. The SUPPORT_MATRIX
lists `Record<K,V>` and `Map<K,V>` as both lowering to `std::map` (§1.5),
but at the **TypeScript** level their APIs differ: `Record` is indexed
(`rec[k]`, no `.has`), `Map` is method-based (`.has`/`.get`/`.set`). Under
`noUncheckedIndexedAccess` (set in the demo `tsconfig`), `rec[k]` is also
`V | undefined` even after an `in` guard, so the index form needs a
non-null assertion.

**Fix applied in source:** `COST` is a `Map<string, int32_t>` with
`.has`/`.get`/`.set` — the idiomatic, type-safe keyed-table shape for a
table that is built at module scope and read with a membership guard. This
is a source-level idiom, not a transpiler change. (A `Record` would also
work with the `in` operator + `!` assertion, but `Map` is clearer here.)

## Finding B — a class value-field was arrowed to `->` when a same-named pointer variable existed elsewhere (FIXED)

After the Finding A correction, the compile produced **hard `g++` errors**:

```
src\main.ts (190,7) error [call]: base operand of '->' has non-pointer type 'std::vector<Job>'
          this.siftDown(0);
src\main.ts (198,11) error [var_decl]: base operand of '->' has non-pointer type 'std::vector<Job>'
        const tmp: Job = this.heap[i]!;
src\main.ts (229,9) error [if]: base operand of '->' has non-pointer type 'std::vector<Job>'
            if (comesBefore(lc, cur)) {
```

The class field `private heap: Job[] = []` lowers to a `std::vector<Job>`
**value** field (not a pointer). But inside `MinHeap`'s methods, every
`this.heap.X` access was being rendered with an arrow:

- `this.heap.push(job)` → `this->heap->push(job)`   (WRONG)
- `this.heap.pop()!`   → `this->heap->pop()`         (WRONG)
- `this.heap.length`   → `this->heap->size()`        (WRONG)

while the *same* `this.heap.length` in the first method rendered correctly
as `this->heap.size()`. The errors above are the g++ messages for those
stray `->` on a value type, mapped back to their TS statement context.

**Root cause — a name collision, plus an unguarded regex.**
`main()` holds a pointer-typed local:

```ts
const heap: MinHeap = new MinHeap();   // heap is a MinHeap* (new C() → C*)
```

That variable is registered in `globalPointerVarTypes`. During emit,
`fixPointerFieldAccess` (assigned in `emit/emitters/top-level-prep.ts` and
threaded through `statement-renderer.ts` `renderCall` as the
`calleeTransformer`) rewrites a standalone pointer-variable method call
`heap.method` → `heap->method`. It did so with the regex

```
\b${varName}\.
```

The `\b` word boundary also matches **between `->` and the name** in a
member-access chain, so a class field `this->heap` was wrongly rewritten to
`this->heap->` whenever a pointer variable of the same name (`heap`)
existed anywhere in the program. The name-based rewrite could not
distinguish the pointer **variable** `heap` from a same-named class
**field** reached through `this->heap`.

This corrupted every `this.heap.X` access inside `MinHeap`'s methods
(`.push`, `.pop`, `.length`, `.size()`). The intermittent-looking symptom
(some `.size()` correct, some `->size()`) was because the rewrite fires
per-call-statement through the calleeTransformer, and the same
`this.heap.length` rendered correctly when it was the whole return
expression of `size()` (no call statement, no transformer) but wrongly
when it was the callee of a subsequent statement.

Notably, the **`pointerStructFields`** loop in the *same* function already
used a `(^|[^>])` guard and was unaffected — only the **global-pointer-var**
loop used the unguarded `\b` form.

**Why this is hard to trigger by accident:** it requires a **name
collision** between a class value-field and a pointer variable of the same
name. Minimal probes with a differently-named local (e.g. `const pq`)
compiled cleanly, which is what made the bug resist simple isolation.

**Fix applied** (`packages/cuttlefish/src/emit/emitters/top-level-prep.ts`,
`fixPointerFieldAccess`, the `globalPointerVarTypes` loop): the regex now
uses the same `(^|[^>.])${varName}\.` guard as the `pointerStructFields`
loop, so `this->heap.x` / `obj->heap.x` (preceded by `>`) and `a.heap.x`
(preceded by `.`) are left alone; only a standalone `heap.x` (start of
string, or preceded by a non-`.`/non-`>` character) is rewritten to
`heap->x`. Pinned by `tests/packages/transpiler/demo-23-regressions.test.ts`
(5 tests: `.push`, `.pop`, `.length`, indexed `[i]`, and a regression guard
that a standalone pointer-var call is still arrowed).

---

# Summary

| # | Finding | Severity | Status |
|---|---|---|---|
| A | `Record<K,V>` has no `.has()` (TS-level author pitfall; `rec[k]` is `V \| undefined` under `noUncheckedIndexedAccess`) | TS type error | **fixed in source** — `COST` is a `Map<string, int32_t>` |
| B | A class **value-field** `this->heap.X` was arrowed to `this->heap->X` whenever a same-named **pointer variable** existed, via an unguarded `\b` regex in `fixPointerFieldAccess` | error (raw `g++`) | **FIXED** — `(^|[^>.])` guard added to the global-pointer-var loop (`emit/emitters/top-level-prep.ts`) |

## Build verdict

- **`npm run lint` exits 0** (no warnings).
- **`npm run compile` exits 0**. `g++` emits **no errors and no warnings**.
  The transpiler emits no diagnostics.
- The binary runs with **all-correct output**, verified by hand against the
  known `(priority, seq)` ordering of the seeded jobs.
- **One transpiler fix was applied for this demo** (Finding B), pinned by
  5 regression tests in `tests/packages/transpiler/demo-23-regressions.test.ts`.
  The full vitest suite passes (**89 files, 1286 tests passed, 18 skipped,
  0 failed**) — the fix introduced no regressions. The demo source carries
  no workarounds; it is in its fully idiomatic shape.
