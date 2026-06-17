# Task-List Tracker — cuttlefish demo #17

A **simple, idiomatic TypeScript** program: a small in-memory to-do tracker. A
`TaskList` class keeps `Task` structs in an array and supports adding,
completing, counting, and summarizing them. The driver seeds a few everyday
tasks, completes one, and prints the list plus a short summary. Transpiled to
C++ by cuttlefish (`@typecad/framework-native`).

This is the **seventeenth** demo iteration. Like #15/#16 it is deliberately
**small and readable** — real, everyday TypeScript — and is **not** a
feature-exhaustion test. The source uses its natural idiomatic form throughout:
the one transpilation gap it surfaced is now **fixed in the transpiler**.

## Running

```bash
npm run lint      # ESLint with the cuttlefish transpiler-rules plugin
npm run compile   # transpile TS -> C++ and compile with g++
# binary lands in demo/src/out/.build/main.exe
```

- **`npm run lint` exits 0.** It emits **one expected warning** from the new
  `no-readonly-loop-variable-mutation` rule (the `const t` loop var mutated via
  `t.done = true` in `complete()`). Warnings don't fail the build; the rule
  surfaces the auto-demotion so the author *may* use `let` to express intent.
  When `g++` does emit errors they are surfaced verbatim and mapped back to
  TypeScript source spans.
- **`npm run compile` exits 0.** It emits **one info diagnostic**
  (`ownership-const-content-mutated`) reporting that `t` was demoted.
- The binary runs with correct output.

## Sample output

```
complete_found=true
top=High
open=3
---
[ ] #1 (Medium) buy milk
[x] #2 (High) fix bike
[ ] #3 (Low) read book
[ ] #4 (High) pay rent
done
```

Verified by hand: 4 tasks seeded; completing #2 succeeds (`complete_found=true`)
and marks it `[x]`; of the 3 remaining open tasks (#1 Medium, #3 Low, #4 High)
the top priority is `High`; `open=3`.

## What the source exercises

Idiomatic patterns that lower cleanly:

- §1.2  fixed-width ints (`int32_t`) and `boolean` → `bool`
- §1.4  template literals (`${...}`) → `snprintf`; ternary `mark`
- §1.6  `interface Task` → C++ `struct`; object-literal construction
- §1.7  `const enum Priority` (inlined); numeric `switch` / `default`;
        enum relational comparison (`t.priority > top` → `static_cast<int>`)
- §3.1  multi-file module structure (`task` + driver); pure free functions
- §4.1  `class TaskList` with private fields + field initializers
- §4.2  `this.field` read/write; `this->` lowering; `new TaskList()` → pointer
- §4.3  instance methods (`add`/`complete`/`openCount`/`topPriority`/`printAll`)
- §5.1  comparison `===`; relational `>`; compound arithmetic; `!t.done`
- §5.3  `Array.push` (promotes backing storage); `.length` on array
- §2.2  `for...of` over a struct array; a **mutated** `const` loop variable
        (`t.done = true` in a class method) — now demoted to `for (T& t : ...)`

---

# Transpilation issues found by Demo #17 — RESOLVED

Demo #17 is a **plain `for...of` + struct-mutation** program — everyday
TypeScript. It surfaced **one** issue, now **fixed in the transpiler**, pinned
by `tests/packages/transpiler/demo-17-regressions.test.ts` (5 tests).

## Fix A — a `const for...of` loop variable mutated in a class method now demotes

| Finding | Fix | File(s) |
|---|---|---|
| A `for (const t of arr)` whose body mutates a field/index of `t` (`t.done = true`), inside a **class method**, emitted `for (const Task& t : ...)` — a const reference — so `t.done = true` was a hard g++ error ("assignment of member 'Task::done' in read-only object"). The same code in a free function already demoted correctly. | The ownership const-content-mutation walk (`validateConstSuggestions`) previously only walked `program.functions` and `program.topLevelStatements`. It now also walks **class methods, getters, setters, constructors, and namespace-scoped functions** (recursively into nested namespaces/classes). The existing member-assignment demotion then fires and flips the loop variable to non-const, emitting `for (Task& t : ...)` — a mutable reference that compiles and writes through to the vector element (matching TS semantics). The `++`/`--` update case (`t.hits++`) was also added to the demotion (it only handled `=` before). A read-only loop var stays `const T&` (no over-demotion). | `ir/ownership-analysis.ts` |

**Before:** `for (const Task& t : this->tasks) { ... t.done = true; ... }` → g++ error.
**After:**  `for (Task& t : this->tasks) { ... t.done = true; ... }` — correct.

This is a latent gap the demo also closes: a **`const`-bound collection**
mutated via `.set()`/`.add()` inside a class method now demotes too (the same
walk-extension reaches it). Previously only free functions demoted.

### Raw g++ error that motivated the fix

The original failure, captured by running `g++` on the generated sources the
same way `cuttlefish build --compile` does (via `spawnSync`):

```
main.h: In member function 'bool TaskList::complete(int32_t)':
main.h:33:16: error: assignment of member 'Task::done' in read-only object
   33 |         t.done = true;
      |         ~~~~~~~^~~~~~
```

and the transpiler's source-mapped form:

```
src\main.ts (52,7) error [if]: assignment of member 'Task::done' in read-only object
        if (!t.done) {
        ^
```

## New ESLint rule (persists into new projects)

**`no-readonly-loop-variable-mutation`** (warn) — fires at lint time when a
`const` `for`/`for-in` loop variable is mutated in the loop body (`t.field =`,
`t[i] =`, `t.field++`), surfacing the auto-demotion early with a clear,
source-located message so the author can express intent with `let`. Mirrors
`no-mutating-method-on-const-collection` (demo #15). Emitted into every
scaffolded project's `eslint-transpiler-rules.mjs` (via
`create/eslint-rules-template.ts`) and enabled in its `eslint.config.mjs`
(via `create/init-templates.ts`), and added to the repo-root plugin + demo
config for parity.

## Build verdict

- **`npm run lint` exits 0** (1 expected warning from
  `no-readonly-loop-variable-mutation`).
- **`npm run compile` exits 0** (1 info `ownership-const-content-mutated`
  diagnostic reporting the demotion). **The binary runs with all-correct
  output**, verified by hand.
- **Full transpiler suite: 1114 passed, 1 failed (pre-existing, unrelated
  `null as any` fixture in `multi-file.test.ts`), 19 skipped** (82 files). The
  5 new demo-17 tests pass.
