# Infix → RPN expression evaluator — cuttlefish demo #22

A **mid-complexity, idiomatic TypeScript** program implementing Dijkstra's
**shunting-yard algorithm**: it tokenizes an infix arithmetic expression,
converts it to **Reverse Polish Notation**, prints the RPN, then evaluates
the RPN and prints the result. Transpiled to C++ by cuttlefish
(`@typecad/framework-native`).

This is the **twenty-second** demo iteration. Like #15–#21 it is deliberately
**readable** — real, everyday TypeScript — and is **not** a feature-exhaustion
test. It is a single self-contained `main.ts`. It deliberately picks a
**different data shape** from #18–#21 (which were CRUD-over-struct-array,
container-valued maps, and a byte-array sieve):

- a **discriminated `interface Token`** (struct with a `const enum` kind
  field) — value-typed structs flowing through arrays,
- a **precedence `Map<string, int32_t>`** keyed by operator characters,
- a **token-stream `Token[]`** and **`string[]` operator stack / output
  queue** held as instance fields (`.push` / `.pop` / indexed read / `.length`
  on `this.field`),
- an **`Evaluator` class** whose methods call module-scope free functions
  (`tokenize`, `precedenceOf`, `isRightAssoc`, `applyOp`),
- a numeric **`switch` over a `const enum`**, a `while` loop with `break`,
  nested conditionals, and early `return`.

The first compile attempt surfaced **three real transpiler gaps** (Findings
A, B, C). All three are now **FIXED** in the transpiler and pinned by
`tests/packages/transpiler/demo-22-regressions.test.ts`. An adjacency
stress-test of the same code paths then surfaced a fourth, latent bug
(Finding F — `.length` on a Map/Set field), also **FIXED**. 10 regression
tests in total pin all four. The
source is now in its fully idiomatic shape (no workarounds). The previous
iteration (#21, number-theory explorer) is preserved in `demo21-backup/`.

## Running

```bash
npm run lint      # ESLint with the cuttlefish transpiler-rules plugin
npm run compile   # transpile TS -> C++ and compile with g++
# binary lands in demo/src/out/.build/main.exe
```

- **`npm run lint` exits 0** with no warnings.
- **`npm run compile` exits 0**. `g++` emits no errors and no warnings. The
  transpiler emits 1 informational diagnostic (`ownership-suggest-const` —
  a style hint, see Finding D); none are errors.
- When `g++` *does* emit errors they are surfaced verbatim and mapped back to
  TypeScript source spans — that is exactly how Findings A and B were
  discovered on the first compile attempt.
- The binary runs with correct output.

## Sample output

```
source: ( 3 + 4 ) * 5 - 6 / 2
rpn:    3 4 + 5 * 6 2 / -
result: 32
done
```

Verified by hand:

- **RPN derivation** (shunting-yard):
  - `3` → out `[3]`
  - `+` → ops `[+]`
  - `4` → out `[3, 4]`
  - `)` → pop `+` → out `[3, 4, +]`
  - `*` → ops `[*]`
  - `5` → out `[3, 4, +, 5]`
  - `-` (prec 10): `*` (prec 20) > 10, pop `*` → out `[3, 4, +, 5, *]`; push `-`
  - `6` → out `[3, 4, +, 5, *, 6]`
  - `/` (prec 20): `-` (prec 10) < 20, no pop; push `/`
  - `2` → out `[3, 4, +, 5, *, 6, 2]`
  - drain → out `[3, 4, +, 5, *, 6, 2, /, -]`

  Matches `3 4 + 5 * 6 2 / -` ✓.
- **Evaluation**: `3 4 +` = 7; `5 *` = 35; `6 2 /` = 3; `-` = 35 − 3 = **32** ✓.
- **Original**: `(3 + 4) × 5 − 6 / 2 = 7 × 5 − 3 = 35 − 3 = 32` ✓.

## What the source exercises

Idiomatic patterns that lower cleanly (all confirmed by this demo's clean
compile):

- §1.2  `int32_t`; `boolean` → `bool`; `string` → `std::string`
- §1.5  `string[]` / `Token[]` → `std::vector<...>`; `Map<string,int32_t>`
        → `std::map`; `Map.has` → `.count(k) > 0`; `Map.set` → `m[k] = v`;
        `Map.get(k)!` → `m.at(k)`; **array `.push`/`.pop` on an
        instance-field receiver** (`this.ops.pop()` → `__tc_pop(this->ops)`,
        `this.ops.push(x)` → `this->ops.push_back(x)` — Finding A fixed)
- §1.6  `interface Token` → value-typed `struct Token`; struct literal
        `{ kind, text }` → brace-init
- §1.7  `const enum TokenKind` (inlined); enum equality comparison lowered
        via `static_cast<int>`
- §1.8  **narrowed enum-member unions** (`t.kind` after an `if`/`continue`)
        and **same-kind string-literal unions** coalesce to a single
        primitive type — Finding C fixed (no false `TS2CPP_UNCLASSIFIABLE_TYPE`)
- §1.4  template literals with a `${...}` interpolation of a top-level
        `const std::string` and a method return value
- §5.3  `parseInt`; `String.charAt`; string concatenation
- §3.1  module-scope free functions (`tokenize`, `classifyChunk`,
        `precedenceOf`, `isRightAssoc`, `applyOp`, `parseIntSafe`)
- §4.1  `class Evaluator` with private `string[]` fields + initializers
- §4.2  `this.ops` / `this.output` read/write → `this->...`; `new Evaluator()`
        → pointer
- §4.3  instance methods; **class methods calling module-scope free
        functions** — including a call nested inside a parenthesized
        sub-expression (`!isRightAssoc(op)` within `||`) — Finding B fixed
- §2.1  `if` / `else` chains; early `return`
- §2.2  `for...of` over `Token[]`; C-style `for (let i; i < count; i = i+1)`
        against a fixed-width bound; `while` with `break`

---

# Transpilation issues found by Demo #22

Demo #22 was written in its natural idiomatic shape. The **first**
`npm run compile` produced **four hard `g++` errors** and aborted the build.
Diagnosis revealed three distinct transpiler gaps; **all three are now FIXED**
in the transpiler source and pinned by regression tests. An adjacency
stress-test of the same code paths later surfaced a fourth, latent bug
(Finding F), also fixed. The demo source required no workarounds after the
fixes.

## Finding A — `.pop()` (and other array mutators) on an instance-field array lowered to a member call on `this` (FIXED)

The shunting-yard pops operators off the instance field:

```ts
class Evaluator {
  private ops: string[] = [];
  toRpn(tokens: Token[]): string[] {
    while (this.ops.length > 0) {
      const top: string = this.ops.pop()!;     // ← this.ops.pop()
```

The native strategy lowers `.pop()` to the free-function helper `__tc_pop`
via a regex. The receiver capture used `(\w+)`, which stopped at the `>` in
`this->ops` (the emitted C++), capturing only `ops` and emitting
`this->__tc_pop(ops)` — calling `__tc_pop` as a *member* of `this`. g++
reported `'class Evaluator' has no member named '__tc_pop'`. The same
`(\w+)` receiver pattern applied to every array/string-mutator regex, so
`.push`/`.shift`/`.unshift`/`.sort`/`.fill`/`.concat`/`.splice`/`.map`/
`.filter`/... on a member receiver were all affected.

Raw `g++` errors (mapped to TS source), from the first compile:

```
src\main.ts (202,7) error [while]: 'class Evaluator' has no member named '__tc_pop'
src\main.ts (219,7) error [call]:  'class Evaluator' has no member named '__tc_pop'
src\main.ts (233,7) error [if]:    'class Evaluator' has no member named '__tc_pop'
```

**Fix applied** (`packages/framework-native/src/strategy.ts`,
`normalizeRawExpression`): a shared `RECV` pattern
`[\w$]+(?:->\w+|\.\w+)*` that matches the full member-access chain
(`ops`, `this->ops`, `obj.field`, `a->b->c`) now drives every array/string-
mutator rewrite, so `this.ops.pop()` lowers to `__tc_pop(this->ops)` and
`this.ops.push(x)` lowers to `this->ops.push_back(x)`. Pinned by
`tests/packages/transpiler/demo-22-regressions.test.ts` (Finding A: 4 tests).

## Finding B — a free function called from a class method, nested inside a parenthesized sub-expression, was tree-shaken out (FIXED)

`isRightAssoc(op)` was called from inside `Evaluator.toRpn` as
`!isRightAssoc(op)` within the right side of an `||`, wrapped in `(...)`:

```ts
if (topPrec > curPrec || (topPrec === curPrec && !isRightAssoc(op))) { ... }
```

The function was correctly forward-declared (the forward-declaration walker
has its own IR traversal), but a **later** reachability/tree-shaking pass
removed it entirely as "unreachable" → g++ `'isRightAssoc' was not declared
in this scope`.

**Root cause:** the `paren` IR node — which exists to preserve explicit TS
grouping, e.g. `(a + b) * c` — had **no case** in
`collectExpressionIdentifiers` (`packages/cuttlefish/src/ir/identifier-collector.ts`).
So any identifier nested inside parentheses was invisible to the
call-graph/reachability pass. A free function whose only call site sat
inside parens (common in compound conditions) was therefore dropped.

Raw `g++` error (mapped to TS source), from the first compile:

```
src\main.ts (218,5) error [while]: 'isRightAssoc' was not declared in this scope
```

**Fix applied** (`packages/cuttlefish/src/ir/identifier-collector.ts`): added
`case "paren"` (recurse into `inner`), plus the three other ExpressionIR
kinds that were also missing handlers — `lambda`, `tuple-access`, and
`hal-expr` — so any identifier nested inside them is now visible to the
call graph. Pinned by `tests/packages/transpiler/demo-22-regressions.test.ts`
(Finding B: 2 tests).

> **Note on the initial diagnosis:** the demo #22 README's first draft
> attributed this to a `bool`-return-type gap in the forward-declaration
> emitter. That was wrong — a focused probe showed `bool`-returning free
> functions ARE forward-declared correctly in both emit modes. The real
> cause was the missing `paren` case above (the function was declared but
> then tree-shaken).

## Finding C — `TS2CPP_UNCLASSIFIABLE_TYPE` fired on narrowed enum / same-kind literal unions (FIXED)

After `if (t.kind === TokenKind.Number) { ... continue; }`, TypeScript
**narrows** `t.kind` to a union of the remaining enum members
(`TokenKind.Operator | TokenKind.LParen | TokenKind.RParen`). Likewise `tok`
in `evalRpn` narrows to `"+" | "-" | "*" | "/"`. Both lower to a single
primitive C++ type (the enum's integral type, or `std::string`), so the
warning was a **false positive**:

```
warning [TS2CPP_UNCLASSIFIABLE_TYPE] (197,11): Expression 't.kind' has type
  'TokenKind.Operator | TokenKind.LParen | TokenKind.RParen', which the type
  classifier does not yet recognize.
```

**Root cause:** `canonicalize()` in
`packages/cuttlefish/src/orchestrator/semantic-facts.ts` only handled
**nullish** unions (`T | null`). A non-nullish union fell through to
`"unknown"`, even when every constituent was the same primitive kind.

**Fix applied:** `canonicalize()` now coalesces a non-nullish union when
every constituent canonicalizes to the **same** category (a narrowed enum
union → `primitive`; a same-kind string-literal union → `primitive`). A
**heterogeneous** union (`number | Point` — constituents of different
categories) still classifies as `"unknown"` (the genuine hazard). Pinned by
`tests/semantic-gates.test.ts` (3 cases) and
`tests/packages/transpiler/demo-22-regressions.test.ts` (Finding C: 2 tests).

## Finding D — `ownership-suggest-const` on `main`'s `tokens` (informational style hint, by design)

```
warning [ownership-suggest-const] (286,9): 'tokens' is never reassigned.
  ↳  const tokens = ...;  // or annotate with Shared to also enforce const T& at the C++ level
```

`tokens` is already declared `const` in the TypeScript source; the warning is
about the *emitted* C++ binding (the transpiler emits it non-`const` and
suggests annotating with `Shared<T>` to enforce `const T&` at the C++ level).
This is a style hint, not an error, and has no behavior impact. Left as-is.

## Finding E — `const Map` populated with `.set()` triggers `no-mutating-method-on-const-collection` (lint warning, fixed in source)

The natural declaration of the precedence table is a module-scope `const`
`Map` populated with `.set()`:

```ts
const PRECEDENCE: Map<string, int32_t> = new Map();
PRECEDENCE.set('+', 10);   // ← mutating a const-bound Map
```

This triggers one `cuttlefish/no-mutating-method-on-const-collection` lint
warning per `.set()` call. SUPPORT_MATRIX §1.5 documents that the transpiler
**auto-demotes** such a binding to non-`const`, and the lint rule exists to
surface the demotion so the author can express intent with `let`.

**Fix applied in source:** `PRECEDENCE` is declared with `let` (with an
explanatory comment), which silences the warning and matches the mutation
intent. This is a source-level idiom, not a transpiler change.

## Finding F — `.length` on a Map/Set instance field lowered to `strlen` (FIXED, surfaced by the adjacency probe)

Not surfaced by the demo itself (it never reads `.length` on a Map/Set
field), but found while stress-testing the **adjacency** of the Finding A/B/C
code paths against related patterns. `this.m.length` on a `Map`/`Set` field:

```ts
class C {
  private m: Map<int32_t, int32_t> = new Map();
  public n(): int32_t { return this.m.length; }   // ← this.m.length
}
```

…lowered to `strlen(this->m)` — the `resolveLengthProperty` member-receiver
path (in `ir/expression-to-ir.ts`) only recognized `std::string` /
`std::vector` / `StaticArray` field types and fell through to the C-string
`strlen()` default for everything else, emitting `strlen` on a `std::map`
struct (invalid C++, or silently miscompiling). A bare-identifier
`Map.length` was already correct (the type-aware path handles it); only the
`this.field` member-receiver path was broken.

**Fix applied** (`packages/cuttlefish/src/ir/expression-to-ir.ts`,
`resolveLengthProperty`): the `this->field.length` branch now routes every
STL container field type (`std::map`/`std::set` added to the existing
`std::vector`/`StaticArray` check) to `.size()`, and keeps `strlen` only for
explicit `const char*`/`char*` fields. Pinned by
`tests/packages/transpiler/demo-22-regressions.test.ts` (Finding F: 2 tests).

---

# Summary

| # | Finding | Severity | Status |
|---|---|---|---|
| A   | `.pop()`/`.push()`/... on an **instance-field** array → `this->__tc_pop(field)` (member call, no such member) | error (raw `g++`) | **FIXED** — shared `RECV` receiver pattern in `framework-native/src/strategy.ts` |
| B   | a free function called from a class method **inside a parenthesized sub-expression** was tree-shaken out | error (raw `g++`) | **FIXED** — added `paren`/`lambda`/`tuple-access`/`hal-expr` cases to `ir/identifier-collector.ts` |
| C   | `TS2CPP_UNCLASSIFIABLE_TYPE` on narrowed enum / same-kind literal unions | false-positive warning | **FIXED** — `canonicalize()` coalesces same-category non-nullish unions (`orchestrator/semantic-facts.ts`) |
| D   | `ownership-suggest-const` on `main`'s `tokens` (already `const` in TS) | style hint | **no impact** — by design |
| E   | `const Map` populated with `.set()` → `no-mutating-method-on-const-collection` | lint warning | **fixed in source** — `PRECEDENCE` declared with `let` |
| F   | `.length` on a **Map/Set instance field** → `strlen(this->m)` (member-receiver path only knew string/vector types) | latent bug (invalid C++) | **FIXED** — every STL container field type routes to `.size()` in `resolveLengthProperty` (`ir/expression-to-ir.ts`); surfaced by the adjacency probe |

## Build verdict

- **`npm run lint` exits 0** (no warnings) after the Finding E `let` fix.
- **`npm run compile` exits 0**. `g++` emits **no errors and no warnings**.
  The transpiler emits 1 informational diagnostic (Finding D); none block
  the build.
- The binary runs with **all-correct output**, verified by hand against the
  known RPN form and value of `(3 + 4) * 5 - 6 / 2` (= 32).
- **Four transpiler fixes were applied for this demo** (Findings A, B, C, and
  F — the last surfaced by an adjacency stress-test of the A/B/C code paths,
  not by the demo itself), each pinned by a regression test in
  `tests/packages/transpiler/demo-22-regressions.test.ts` (10 tests). The
  SUPPORT_MATRIX §5.3 (caveat 4 + `.length` row) and §4.3 row, and
  DEMO_COVERAGE.md, were updated to reflect the resolved behavior. The demo
  source carries no workarounds — it is in its fully idiomatic shape.
