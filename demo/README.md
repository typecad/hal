# Markdown flattener + word-frequency analyzer — cuttlefish demo #30

A **mid-complexity, idiomatic TypeScript** program built around two cooperating
text-processing utilities that share one line-based model:

1. **A markdown flattener** — `class Markdown` walks a small, hand-written
   markdown document line-by-line, classifies each line by a leading marker
   (`#`, `-`, `*`, `>`, digit+`.`), strips the marker, removes inline emphasis
   (`*foo*`, `_foo_`), and emits a plain-text line. A `const enum Block` +
   numeric `switch` is the classifier.
2. **A word-frequency analyzer** — `class WordFreq` ingests the flattened text,
   splits it on whitespace, lowercases each token, drops stop words against a
   `Set<string>`, and tallies the survivors in a `Map<string, number>`. The
   top-N entries are reported via a small selection sort over a `WordCount[]`
   array of structs.

Transpiled to C++ by cuttlefish (`@typecad/framework-native`).

This is the **thirtieth** demo iteration. Like #15–#29 it is deliberately
**readable** — real, everyday TypeScript — and is **not** a feature-exhaustion
test. It deliberately picks a **different data shape** from #15–#29
(CRUD-over-struct-array, container maps, byte sieve, token stream, min-heap,
prefix-trie, doubly-linked list, disjoint-set forest, Vigenère cipher,
Brainfuck interpreter, CRC-32 + INI parser):

- **chained string methods** — `.split(...)` whose `string[]` result is
  indexed and then has `.charAt`/`.charCodeAt`/`.slice` called on the
  *element*, and `freeFn(x).trim().toLowerCase()` chained where a free
  function's result feeds a string-method lowering. No prior demo built a
  method chain whose intermediate result reaches a free function the
  transpiler must resolve by walking a lowered `raw` wrapper.
- **`Set<string>` membership filtering** of tokens — `stop.has(word)` drives a
  keep/drop decision.
- **a `Map<string, number>` tally** with `.has`-guarded `.get` +
  `.set(..., count + 1)` increments.
- **a `WordCount[]` struct array** built by `push` and sorted by a hand-rolled
  selection sort (sort-with-comparator had gaps in demo #12).
- a **`const enum` + `switch` with a `case X: default:` fall-through body** —
  the Plain and default branches share one body. No prior demo used the
  fall-through-into-default idiom.
- **`new Set([...])` constructor-with-initial-elements** — the idiomatic TS
  way to seed a stop-word set. No prior demo used the populated Set/Map
  constructor.
- a `class` with BOTH a `Map` field AND a `number[]`/`string[]` field, a
  module-scope free function called from a class method, `for...of` over
  `string[]`, C-style `for` loops, and template literals interpolating
  `number`/`string`/`boolean` values.

The previous iteration (#29, CRC-32 + INI parser) is preserved in
`demo29-backup/`.

## Running

```bash
npm run lint      # ESLint with the cuttlefish transpiler-rules plugin
npm run compile   # transpile TS -> C++ and compile with g++
# binary lands in demo/src/out/.build/main.exe
```

- **`npm run lint` exits 0** with no warnings.
- **`npm run compile` exits 0**. `g++` emits **no errors and no warnings**.
- When `g++` *does* emit errors they are surfaced verbatim and mapped back to
  TypeScript source spans (see *Findings* below for the ones this demo hit on
  its first compile, and how each was fixed in the transpiler).

## Sample output

```
--- Markdown + word-frequency demo ---
[md] lines    = 8
[md] chars    = 223
[md] flat     = begin
Demo Document
This is a short paragraph with emphasis in it.
first bullet point here
second bullet has words
ordered item one
ordered item two
a quoted sentence with several words
Final paragraph wraps up the demo document.
[md] flat     = end
[wf] distinct = 21
[wf] total    = 54
[wf] top5     = begin
  bullet (4)
  demo (4)
  item (4)
  ordered (4)
  paragraph (4)
[wf] top5     = end
done
```

Verified by hand:

1. **Markdown flattening** — all 8 content lines survive (heading, paragraph
   with emphasis, 2 bullets, 2 ordered items, blockquote, final paragraph).
   Inline `*short*`/`_emphasis_` markers are stripped; `#`, `-`, `>`, `1.`
   leading markers are dropped; the heading case does not strip emphasis (it
   has none). ✓
2. **Stop-word filtering** — `STOP_WORDS` (a 20-word set: a, an, the, in, on,
   of, to, is, it, with, and, or, has, have, here, up, this, that, these,
   those) is correctly seeded by `new Set([...])` and filters those tokens
   out. `distinct = 21` (27 content tokens minus stop words), `total = 54`
   (ingested twice). ✓
3. **Top-5 by count** — five words tie at count 4 (`bullet`, `demo`, `item`,
   `ordered`, `paragraph`); ties break alphabetically (ascending) for
   deterministic output. ✓

---

# Transpilation issues found by Demo #30

Demo #30 was written in its natural idiomatic shape. Its first compile surfaced
**four distinct issues — all four real transpiler gaps**, now **FIXED in the
transpiler** and pinned by `tests/packages/transpiler/demo-30-regressions.test.ts`
(14 tests). The demo source has been reverted to its natural idiomatic form (it
carries no workarounds) and recompiles clean, producing correct output. Two of
the four (A and the B raw-node sibling) share one underlying theme — **the
emit layer had a parallel, hand-rolled walk / hardcoded specifier that
diverged from the canonical lowering path** — noted as the common root cause at
the end.

## Finding A — a free function called from a class method ONLY through a lowered `raw` wrapper was invisible to the class-method visibility walk

```
src\main.ts (109,27) error [block]: 'stripLeading' was not declared in this scope
            case Block.Quote: {
                            ^
src\main.ts (115,29) error [block]: 'stripEmphasis' was not declared in this scope
            case Block.Ordered: {
                                ^
... (~6 more errors of the same shape, plus matching -Wunused-function warnings)
```

The idiomatic TS expression `stripLeading(line, '#').trim()` inside
`Markdown.flatten` lowers to `__tc_trim(stripLeading(line, "#"))` — the inner
`stripLeading(...)` call lives INSIDE the `raw` IR text that the string-method
lowering produces. `stripLeading`, `stripEmphasis`, `stripOrdered`,
`isOrderedItem`, `isDigit`, and `compareStrings` are all module-scope free
functions called from `Markdown`/`WordFreq` method bodies, but ONLY through
such lowered `raw` wrappers.

**Root cause (generalizable):** the class-method visibility decision (which
free functions need a non-`static` header prototype vs. can stay `static` in
the .cpp, per demo #18 fix B) lived in `emit/emitters/setup.ts` and had its
OWN hand-rolled IR walk (`collectFromExpr`/`collectFromStmt`) that inspected
only structured `call`/`method-call` IR nodes. It did NOT extract identifiers
from `raw` IR text. The canonical walk in `ir/identifier-collector.ts`
(`collectExpressionIdentifiers`/`collectStatementIdentifiers`) DOES extract
from `raw` (it has a `case "raw"` that regex-extracts identifier tokens). So a
free function reached only through a `raw` wrapper was visible to the
**tree-shaking** walk (which used the canonical collector) but invisible to
the **class-method visibility** walk (which used its own). The two parallel
walks over the same IR diverged.

This is the **same blind-spot family** as demo #22 Finding B (a call nested in
a `paren` IR node, fixed in the canonical collector) and demo #28 Finding C (a
call nested in a `__RAW_STMT__` wrapper, fixed in the canonical collector) —
each demo found the divergence in a *different* walk that had re-implemented
the traversal instead of reusing the canonical one.

**Fix:** `setup.ts` now reuses the canonical `collectStatementIdentifiers`
instead of its own hand-rolled recursion. This is the widest fix — it covers
every IR shape the canonical collector knows (`raw`, `paren`, `lambda`,
`tuple-access`, `hal-expr`, ...), so any free function reached through ANY
lowering is visible to the class-method walk. The idiomatic source uses the
natural `freeFn(x).trim()` form.

## Finding B — `.length` on a `std::string` returned an unsigned `size_type`; the snprintf format for `.length`/`.size` was hardcoded `%d`

```
src\main.ts (419,3) warning [call]: format '%d' expects argument of type 'int', but argument 4 has type 'std::__cxx11::basic_string<char>::size_type' {aka 'long long unsigned int'} [-Wformat=]
      console.log(`[md] chars    = ${flat.length}`);
      ^
```

`flat` is a `std::string` local; `${flat.length}` interpolates `flat.length()`
into a template literal. `std::string::length()` returns `size_type` (unsigned
`long long` on this target), but the snprintf format specifier inferred for a
`.length`/`.size` property access was hardcoded to `%d` (signed `int`).

**Root cause (generalizable):** two divergences in one:

1. **The lowering diverged across receiver kinds.** `.length` on an array/
   vector lowered to `static_cast<long long>(x.size())` (signed, cast to match
   loop-counter type — demos #22/#27). But `.length` on a `std::string`
   lowered to the bare `s.length()` (unsigned, no cast). The two paths that
   both implement "TS `.length`" produced values of different signedness.
2. **The format specifier diverged from the rendered arg.** The snprintf
   format inference (`expression-renderer.ts` `inferFormatSpecifier`) hardcoded
   `%d` for ANY `.length`/`.size` property access, regardless of whether the
   rendered arg was the unsigned `s.length()` or the signed
   `static_cast<long long>(x.size())`. Either way it was wrong for one of them.

**Fix:** `.length` on a `std::string` now ALSO casts to
`static_cast<long long>(s.length())`, making `.length`/`.size` **uniform**
across every receiver (array/vector/string/Map/Set — all signed `long long`).
The snprintf specifier for `.length`/`.size` is now `%lld` to match, in BOTH
the `property-access` IR path AND the lowered `raw`-node path (a `.length` on
a local array lowers to a `raw` IR node whose text is
`static_cast<long long>(x.size())`; the `raw` case in `inferFormatSpecifier`
now recognizes that shape and returns `%lld`). The idiomatic source uses the
natural `${s.length}` form.

## Finding D — a `switch` with `case X: default: { body }` lowered the shared body into the `else` branch only, so `case X` ran nothing

```
(no g++ error — this was a SILENT runtime bug)
```

The `Markdown.flatten` switch has a `case Block.Plain: default: { push(line) }`
arm — the Plain case and the default share one body. After fixing A and B, the
demo compiled clean but produced **wrong output**: the two Plain lines ("This
is a short paragraph..." and "Final paragraph...") were MISSING, and `[md]
lines` was 6 instead of 8.

**Root cause (generalizable):** TS parses `case X: default: { body }` as TWO
clauses: a `case X` with an EMPTY body (it falls through) and a `default`
carrying the shared body. The switch→`if/else if` lowering
(`emit/emitters/line-appender.ts`) emitted one branch per clause: an empty
`if (kind == Plain) { }` and a `} else { body }`. So `kind == Plain` matched
the empty branch and ran NOTHING — the shared body only ran in the default.
TS semantics: `kind == Plain` falls through into `default`'s body, so the body
runs for BOTH Plain and default.

An `if/else if` chain cannot express "X OR default → body" (default is the
mutually-exclusive catch-all). The faithful lowering must GROUP consecutive
fall-through cases (empty-body cases) with the next clause that HAS a body.

**Fix:** the chain builder now pre-groups the cases before emitting. A group
is one or more conditions (from empty-body named cases) plus optionally a
`default`, terminated by the first clause that has a real body. The group
emits as one branch: named conditions OR-joined (`if (x==A || x==B) { body }`),
and a `default` in the group makes the whole group the catch-all `else`
(`case X: default: body` → the body runs for X AND anything else, i.e.
always — which is exactly the semantics). This is the general fix: it handles
`case X: default:` AND chained `case A: case B: body` AND
`case A: case B: default: body`. The idiomatic source uses the natural
`case X: default: { body }` form.

## Finding E — `new Set([...])` / `new Map([...])` constructor-with-initial-elements dropped the initializer and emitted `{}`

```
(no g++ error — this was a SILENT runtime bug)
```

After fixing D, the demo produced 8 lines but the word-frequency output was
wrong: stop words were NOT filtered (e.g. `with (4)` appeared in the top 5
despite `with` being in `STOP_WORDS`). `distinct` and `total` were too high.

**Root cause (generalizable):** `const STOP_WORDS: Set<string> = new Set([...])`
lowered to `const std::set<std::string> STOP_WORDS = {};` — **EMPTY**. The
Set/Map constructor lowering in `ir/expression-to-ir.ts` returned a hardcoded
`{}` regardless of arguments:

```ts
if (baseCtorName === "Set") {
  return { kind: "raw", value: "{}" };   // ← dropped the [...]
}
```

So every `new Set([a, b, c])` and `new Map([[k, v]])` produced an empty
container. The `argsText` (the rendered argument list) was already computed
just above for the general `new` path but never consulted for Set/Map.

**Fix:** when an initializer argument is present, it is rendered into the
brace-init-list. `argsText` already renders a single array-literal argument as
exactly the form the STL constructors accept: `{ a, b, c }` for `std::set`
(`std::initializer_list<T>`) and `{ {k, v}, ... }` for `std::map`
(`std::initializer_list<std::pair>`). The empty-ctor form (`new Set()` /
`new Map()`) still lowers to `{}`. The idiomatic source uses the natural
`new Set([...])` form.

---

## Common root cause: the emit layer diverged from the canonical lowering paths

Two of the four findings (A and the B raw-node sibling) are the same
underlying theme. The transpiler has **canonical** implementations of
recurring operations — the identifier collector (`identifier-collector.ts`),
the `.length` lowering (`resolveLengthProperty`), the string escaper
(`escapeCppStringLiteral`) — but the **emit layer** (`setup.ts`,
`expression-renderer.ts`) had re-implemented pieces of them inline, and those
inline copies drifted:

- **A:** `setup.ts` had its own IR walk that didn't extract from `raw`, while
  the canonical collector did. The two walks over the same IR disagreed.
- **B (raw sibling):** `expression-renderer.ts` hardcoded `%d` for `.length`,
  while the lowering rendered either unsigned `size_type` or signed
  `static_cast<long long>`. The specifier and the rendering disagreed.

The fixes close each divergence by routing the emit-layer decision through the
canonical path: `setup.ts` reuses `collectStatementIdentifiers`; the specifier
recognizes the lowered `static_cast<long long>(...size())` shape. **A and B
were "the canonical path was right, the inline copy was wrong" failures.**

D and E are a different theme — **silent runtime bugs** (not g++ errors). The
demo's first compile surfaced A and B as compile errors; fixing those let the
program build and run, at which point the wrong output revealed D and E. Both
were the transpiler producing *valid C++ with wrong semantics* (a switch that
skipped a case, an empty container). Regression tests for D and E assert on
the **emitted text shape**, not just compilation, so a future regression is
caught at transpile time even if it would still compile.

## What lowered correctly (the point of this demo)

With A/B/D/E fixed in the transpiler, every data shape the demo was written to
stress lowers and runs correctly from its natural idiomatic source:

- **chained string methods** — `raw.trim().toLowerCase()` lowers to
  `__tc_toLowerCase(__tc_trim(raw))` and the chained result feeds the
  `.has`-guarded `Map.set` increment correctly (Finding A made the free-fn
  variant work too).
- **`Set<string>` membership** — `stop.has(word)` lowers to
  `stop.count(word) > 0` and drives the keep/drop (Finding E made the set
  actually contain its elements).
- **`Map<string, number>` tally** — `.has`-guarded `.get` + `.set(..., n+1)`
  lower to `std::map` const-correct `.at()` + `operator[]`.
- **`.length` interpolation** — `${s.length}` lowers to
  `static_cast<long long>(s.length())` with `%lld` (Finding B).
- **`switch` with `case X: default:`** — the shared body runs for X AND
  default (Finding D).
- **`const enum Block` + numeric `switch`**, **`for...of` over `string[]`**,
  **C-style `for` loops**, **selection sort over a `WordCount[]` struct
  array**, **template literals** interpolating `number`/`string`/`boolean`
  all lower cleanly.

---

## What this demo intentionally does NOT cover

To keep the program mid-complexity and idiomatic rather than a
feature-exhaustion test, demo #30 deliberately does **not** exercise:

- `Array.sort(comparator)` (not used — the comparator path had lowering gaps in
  #12; a hand-rolled selection sort is used instead),
- generic classes / functions,
- `extends` / `super` inheritance (covered by earlier demos),
- `try`/`catch` (no exception path in a flattener/analyzer),
- deep recursion (the flattener is iterative by nature),
- multi-file modules (the whole program is one `main.ts`).

Each of those is its own future demo with its own data shape.
