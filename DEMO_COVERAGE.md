# Demo Coverage Tracker

This file tracks which `SUPPORT_MATRIX.md` features have been exercised by the
iterative demo builds and which are still awaiting a demo test. Each demo is a
moderately-complex, multi-file game or simulation transpiled to C++ and compiled
with g++.

> **Note:** the demo index below (#1–#33) refers to the historical iterative
> game/simulation builds. The current `demos/` directory (demo-ui, demo-st,
> ble-demo, wifi-demo, zephyr-blink, …) is a separate, actively-developed set
> of example projects and is not indexed here.

**Legend**

- ✅ **Tested** — exercised by at least one demo (and, where noted, pinned by a
  regression test). The demo number(s) that exercised it are listed.
- 🟡 **Partial** — exercised but only via a constrained path, or a known
  limitation surfaced. Notes explain.
- ⬜ **Untested** — supported per SUPPORT_MATRIX but no demo has exercised it.
- ❌/🚫 — unsupported; not tracked here (see SUPPORT_MATRIX directly).

**Demo index**

| # | Name | Commit | Notes |
|---|---|---|---|
| #1 | Warehouse / inventory | `618332f` | Inferred (no README); enum→number cast fix (G10) |
| #2 | Particle/Star or Sensor (intermediate) | `1d7266f` / `d0ae0af` | Unnumbered exploratory; drove string-enum + bug-fix batch |
| #3 | Verdant ecosystem | `543a79d` | enum arithmetic (`-`) |
| #4 | Caverns of Cuttlefish (dungeon crawl) | `d494f0c` | Introduced `SUPPORT_MATRIX.md`; F1–F12 fixes |
| #5 | Relay packet-router | `af9c484` | bitwise ops on enum operands; 2 new lint rules |
| #6 | Forge factory/crafting | `c25dd5c` | class inheritance + polymorphism; A–H fixes |
| #7 | Wattage power-grid sim | (uncommitted) | functional array methods, type aliases, Math.PI, optional call, enum casts, for-in/IIFE gates; A–N fixes |
| #8 | Strata config registry | (uncommitted) | generic class heritage, ownership wrappers, spread, satisfies, §5.1 operators, destructure; A fixed, B–I documented |
| #9 | Conduit message pipeline | (uncommitted) | higher-order functions, parseInt/parseFloat, null/undefined, 2D arrays, labeled continue, do...while; A/C fixed, B/D/E/F documented |
| #10 | Ledger numeric utilities | (uncommitted) | array methods (shift/unshift/reverse/fill/concat), utility types, typeof, angle-bracket cast, int→double, nested templates, switch-no-default; A fixed, B/C documented |
| #11 | Atlas spatial region manager | (uncommitted) | namespace (gated), nested switch, infinite for(;;), try/catch/finally + throw, object spread, keyof, unknown; E fixed, C gated, A/B/D documented |
| #12 | Cipher codec toolkit | (uncommitted) | forEach (gap), sort-with-comparator (wrong result), while(true), standalone block, variable-in-case, Float32Array, NonNullable, export default; A–F documented |
| #13 | KitchenSink (ALL remaining ⬜) | (uncommitted) | comprehensive test of ~30 remaining untested features; A–J documented (inline-type auto, static block, ||=, conditional/mapped types, ReturnType, re-exports, Map.get auto, wrapper-on-alias, nested class in fn) |
| #14 | Round-robin task scheduler | (uncommitted) | abstract base + subclass (no explicit ctor), instance/static getters (incl. cross-file), struct-returning `peek(): T \| null`, `Map`+`Set`, `try/catch/throw`, `Array.sort` comparator, `int32_t` template interp; A/B/D/E/G FIXED in transpiler, C lint-gated (`no-map-struct-mutation`), F stale-diag removed |

| #15 | Inventory stock tracker | (uncommitted) | simple idiomatic TS: Map catalog + Map.values() iteration, const Map reads, const Set; A/B/C FIXED in transpiler (Map.values→__tc_mapValues helpers, Map.get→const-correct .at, const-collection mutation demoted + suggest-const contradiction resolved), D documented (const enum lint-gated); new lint rule `no-mutating-method-on-const-collection` |
| #16 | Unit converter | (uncommitted) | simple idiomatic TS: const enum + interface + Map lookup + switch on an enum-valued struct field; A/B FIXED in transpiler (switch on a property-access discriminant now type-aware — no illegal `std::string(enum)` wrap; ownership demotion now scope-local — a read-only `const` Map no longer demoted due to a same-named binding mutated in a sibling function) |
| #17 | Task-list tracker | (uncommitted) | simple idiomatic TS: a `TaskList` class with a `const enum`/`interface` model, `for...of` over a struct array with a mutated loop variable inside a **class method**; A FIXED in transpiler (const for-of loop var mutation + const-collection mutation now demote inside class methods/getters/setters/ctors and namespace functions — the ownership walk previously only reached free functions; `++`/`--` on a const loop-var member also now demotes), new lint rule `no-readonly-loop-variable-mutation` |
| #18 | Bank ledger | (uncommitted) | simple idiomatic TS: a `Bank` class with a `const enum`/`interface Account` model, a nullable `find(): Account \| null` return compared with `=== null`, module-scope free functions called from a class method, and struct-field interpolation in a template literal; **A/B/C all FIXED** in transpiler — (A) `struct === null` now recognizes *interface* value types and resolves to `false` (was the invalid `struct == 0`); (B) a free function called from a class method is forward-declared **non-static in the header** in split mode (was only `static` in the .cpp, unreachable from the inline method body); (C) emitting a named-typed object literal no longer clobbers the interface's declared field-type map, so struct-field template interpolation picks the correct snprintf specifier instead of collapsing every field to `%lld`. Pinned by `tests/packages/transpiler/demo-18-regressions.test.ts` (8 tests); also un-skipped `multi-file.test.ts`'s free-function-forward-decl case. |
| #19 | Library book tracker | (uncommitted) | simple idiomatic TS: a `Library` of `Book` structs in an array with checkout/return state transitions; transpiled clean on the first attempt — **no findings**. |
| #20 | Gradebook | (uncommitted) | idiomatic TS: a `Gradebook` over `Map<string, number[]>` (container-valued map), drop-lowest-score, per-student averages + letter grades; **A/B/C/D documented as open gaps** — `Array.from(map.entries())` emits verbatim, tuple destructuring of `__tc_mapEntries` → `0 /* unsupported_expr */`, `=== undefined` on a container-typed `Map.get` local → invalid `vector==int`, `.length` not widened in a C-style `for` bound. Source carries idiomatic workarounds; no transpiler fixes applied. |
| #21 | Number-theory explorer | (uncommitted) | idiomatic TS: a Sieve of Eratosthenes + recursive Collatz explorer over `Map<number, number>` (primitive-valued map — the clean path), `Set<number>`, byte-array sieve; **C FIXED** — a typed-array *class field* is now gated by `TS2CPP_TYPED_ARRAY_FIELD` + lint `no-typed-array-field` (it lowered to `uint8_t*` whose `new Uint8Array(N)` brace-init could not initialize a pointer). A/A.2 are the existing by-design `no-typed-array-return` / `no-array-param-content-mutation` gates; B (`.length` on a local typed array) re-verified as already-correct (`sizeof`). |
| #22 | Infix → RPN expression evaluator | (uncommitted) | idiomatic TS: a shunting-yard algorithm over a discriminated `interface Token`, a `Map<string, int32_t>` precedence table, and `string[]` operator/output stacks in an `Evaluator` class; **A/B/C/F all FIXED in the transpiler** — (A) array mutators (`.pop`/`.push`/...) on an **instance-field receiver** (`this.ops.pop()`) now lower correctly to `__tc_pop(this->ops)` instead of the broken `this->__tc_pop(ops)` (the receiver regex used `\w+`, which stopped at `>`); (B) a free function whose only call site is inside a **parenthesized sub-expression** in a class method no longer gets tree-shaken (the `paren` IR node had no case in the identifier collector, so the call-graph never saw the callee); (C) a narrowed enum-member union (`K.B \| K.C`) and a same-kind string-literal union (`"+" \| "-"`) now coalesce to their single primitive category instead of tripping `TS2CPP_UNCLASSIFIABLE_TYPE`; **(F) `.length` on a Map/Set instance field** (`this.m.length`) now lowers to `.size()` instead of the C-string `strlen()` default (the member-receiver path only recognized string/vector field types) — surfaced by the demo #22 adjacency probe, not the demo itself. Pinned by `tests/packages/transpiler/demo-22-regressions.test.ts` (10 tests). |
| #23 | Priority-queue job scheduler | (uncommitted) | idiomatic TS: a **binary min-heap** (`class MinHeap` owning a `Job[]` value field, with sift-up/sift-down + indexed read/write/swap on `this.heap[i]`), a `Map<string, int32_t>` per-kind cost table, a `const enum JobKind` + numeric `switch`, module-scope free functions called from class methods, `Math.min`/`Math.max`, struct-field template literals; **B FIXED in the transpiler** — a class **value-field** `this->heap.X` was arrowed to `this->heap->X` whenever a same-named **pointer variable** existed elsewhere (a name collision): the `globalPointerVarTypes` loop in `fixPointerFieldAccess` (`emit/emitters/top-level-prep.ts`) used an unguarded `\b${var}\.` regex whose `\b` also matches between `->` and the name, so `this->heap` was wrongly arrowed; now uses the same `(^|[^>.])${var}\.` guard as the `pointerStructFields` loop. Pinned by `tests/packages/transpiler/demo-23-regressions.test.ts` (5 tests). **A** is a TS-level author pitfall (`Record<K,V>` has no `.has()`; `rec[k]` is `V \| undefined` under `noUncheckedIndexedAccess`) — fixed in source by using a `Map<string, int32_t>`. |
| #24 | Prefix-index trie | (uncommitted) | idiomatic TS: a **trie** of `class TrieNode` whose fields include a `Map<string, TrieNode>` (a class that *contains* an associative container of its own type), recursion down children, a `class Trie` wrapping the root, a `const enum` + numeric `switch` command interpreter; **B/C/E/F/G/H FIXED** in the transpiler (Map-method `obj.field` receiver, `std::pair` element access, `new Map(map)` copy ctor, `for...of` pointer-valued loop var, Map-field-to-local value-copy, pointer-reached string-field concat specifier) and **A/D worked around** in source. |
| #25 | LRU cache over a doubly-linked list | (uncommitted) | idiomatic TS: a fixed-capacity **LRU cache** built from a `class Entry` with **self-referential pointer fields** (`prev`/`next: Entry \| null`) and a `Map<string, Entry>` field inside `LruCache` for O(1) lookup, sentinel head/tail doubly-linked list with **explicit pointer-field writes through non-`this` local receivers** (`n.next = x; x.prev = n`), a `const enum Op` + numeric `switch`, C-style `for` loops, ternary, template literals; **A FIXED in the transpiler** — the `TS2CPP_MAP_VALUE_COPY_MUTATION` semantic gate was a **false positive** for *class-typed* map values (a class lowers to a pointer, so `map.get(k)` returns a pointer and a field write persists — it is NOT a value copy); the gate now exempts class instances via `isClassInstanceType` (`orchestrator/semantic-facts.ts`). **B FIXED** in the scaffold — a user class named `Node` collided with the DOM `lib`'s global `Node` type; the scaffolded `tsconfig.json` no longer ships `"dom"` in `lib` (the `console` global is declared in `cuttlefish-env.d.ts`), and a new `TS2CPP_GLOBAL_NAME_COLLISION` semantic gate surfaces any remaining collision with one clear diagnostic. Pinned by `tests/semantic-gates.test.ts` (5 + 5 tests) and `tests/packages/transpiler/init-scaffold.test.ts` (2 new assertions). |
| #26 | Disjoint-set forest + Kruskal's MST | (uncommitted) | idiomatic TS: a **union-find** (`class UnionFind` owning TWO parallel `int32_t[]` fields `parent`/`rank`, iterative `findRoot` with **path halving** that writes back into an instance-field array inside a `while` loop — `this.parent[cur] = this.parent[this.parent[cur]]`), union-by-rank, `connected`, plus a **Kruskal MST** driver sharing the DS (local-copy insertion sort + `for...of` over `Edge[]` + `uf.union`), a `const enum Cmd` + numeric `switch` interpreter, template literals interpolating struct fields and array indices; **A FIXED in the scaffold** — the scaffolded `tsconfig.json` shipped `noUncheckedIndexedAccess: true`, which forced an unverified `arr[i]!` assertion on every array-index read with ~zero safety payoff (the emitted storage is always-dense `std::vector`, indices are bounded by `.length` by construction, and the `!` escape hatch is unchecked — pure friction: 11 forced `!`s in 265 lines). The flag is dropped from the `cuttlefish create` template (`create/init-templates.ts`); `strict` + `strictNullChecks` are kept (genuine null/undefined holes still caught). Pinned by `tests/packages/transpiler/init-scaffold.test.ts`. No transpiler emission bugs — the path-halving array-index write (the novel stress) lowered correctly first try. |
| #27 | Vigenère cipher + letter-frequency analysis | (uncommitted) | idiomatic TS: a **`class Vigenere` owning a `string` keyword field AND a parallel `int32_t[]` shift-schedule field** derived from the keyword via `charCodeAt` in the ctor, plus **frequency analysis over a `Map<string, int32_t>`** (`.has()`-guarded `.get()`/`.set()` tally → `CharCount[]` selection-sorted), a `const enum Mode` + numeric `switch` interpreter, a module-scope free function called from a class method, `Math.round`/`Math.abs`, `charCodeAt` on local strings, template literals; **C/D/E/F FIXED in the transpiler** (pinned by `tests/packages/transpiler/demo-27-regressions.test.ts` + `tests/semantic-gates.test.ts`), demo source reverted to natural idiomatic form — (C) `.length` on a function-local `std::vector` now lowers to `static_cast<long long>(x.size())` not the invalid `vector.length()` (`expression-to-ir.ts` `resolveLengthProperty` mutableArrayVars/activeArrayLiteralVars branches); (D) string methods (`.toLowerCase`/`.substring`/`.charAt`/...) on **any receiver shape** (bare id / `this.field` / `obj.field` / `X[i]`) now lower structurally — migrated from the text-rewrite `applyStringMethodRewrites` (whose `RECEIVER_PATTERN` missed `X[i]`/`X->member`) into `tryLowerArrayAndStringMethods`, the same path demo #22 migrated array mutators to; (E) the `__tc_*` string-method helper is now registered (transitively via D — the structural `raw` IR node is scanned by `program-analysis.ts`); (F) `TS2CPP_GLOBAL_NAME_COLLISION` no longer treats `@types/node` declarations as globals — the `globalNames` loop excludes `/node_modules/@types/` (but NOT TS's own `lib.*.d.ts` under `node_modules/typescript/lib/`, so DOM globals are still caught). **A** is standard TS `Map.has`+`.get` narrowing (out of scope; `.get(k)!` workaround); **B** was reclassified as correct C++ (indexing `std::string` yields `char`; the `string[]` shape needs no fix). |
| #28 | Brainfuck interpreter + bracket-matching jump table | (uncommitted) | idiomatic TS: a **Brainfuck interpreter** — a stack-based bracket-matching pre-pass building a **`Map<int32_t, int32_t>` jump table** (an `int32_t[]` used as an explicit LIFO stack), and a **`class Interpreter` owning a `string[]` program field and a parallel `int32_t[]` tape field** that grows on demand inside the fetch loop (`this.tape.push`), a `const enum Op` + numeric `switch` with **braced case bodies**, a module-level `const GLYPHS: string[]` indexed by the enum, a free function called only as a nested argument (`out.push(glyphFor(op))`), a function-init promoted const, `Math.max` in a `for...of`. **A/B/C/D/E all FIXED in the transpiler**, demo source in its natural idiomatic form (no workarounds), recompiles clean with byte-for-byte identical correct output — (A) `String.*`/`Number.*` statics are now **lint-gated AND build-time rejected** (were neither lowered nor gated, so `String.fromCharCode` emitted verbatim → g++ "'String' not declared"); (B) a **promoted top-level variable's** file-scope default initializer is now `{}` (was `= 0` for every non-pointer type, invalid for class types `std::vector<...> = 0;`); (C) a free function called only as a nested argument survives tree-shaking — the `call` statement callee is a lowered `__RAW_STMT__` wrapper and the identifier collector now adds every callee part, not just `calleeParts[0]`, so the inner callee is visible to the call graph; (D) a `switch` with **braced case bodies** strips each case's `break;` when lowered to `if/else if` (was kept → break broke the enclosing loop / hard g++ error outside a loop); (E) an **enum-typed array index** (`GLYPHS[op]`) is cast to `static_cast<int>(op)`. Pinned by `tests/packages/transpiler/demo-28-regressions.test.ts` (8 tests). |
| #29 | CRC-32 checksum + INI-style config parser | (uncommitted) | idiomatic TS: a **CRC-32 implementation** — a `class Crc32` owning a precomputed **`uint32_t[]` lookup table** (256 fixed-width entries) built in the constructor and indexed at runtime, with heavy 32-bit bitwise arithmetic (`^`, `>>>`, `&`) over an accumulator and `charCodeAt` byte-by-byte folding — plus an **INI-style config parser** that `string.split`s each line on `=` into a `Map<string, string>` (`.has`-guarded `.get`/`.set`, `.trim`/`.slice`/`.charAt`), a `const enum` + numeric `switch` line classifier, `for...of` over a `.split()` result, and hex rendering via an explicit nibble lookup (the §5.4 `Number.toString(16)` workaround). **A/B/C/D all FIXED in the transpiler**, demo source in its natural idiomatic form (no workarounds), recompiles clean with byte-for-byte identical correct output (CRC reference vectors `0x00000000` and `0xcbf43926` both verified) — (A) a string literal containing a control char or backslash, rendered as a **method-call argument**, is now escaped via the shared `escapeCppStringLiteral` on the standalone renderer `renderExprAsText` (was only quote-escaped → a raw `\n` inside the C++ string literal → unterminated literal → ~25-error cascade); (B) `new Array<E>(n)` now lowers to `std::vector<E>(n)` (was emitted verbatim → g++ "'Array' does not name a type"), and the untyped `new Array(n)` is build-time rejected with a clear diagnostic; (C) `.size` on a **`this.field`/`obj.field` Map/Set receiver** now lowers to `.size()` (was only bare-identifier receivers — same gap shape demos #22/#27 fixed for `.length`); (D) an **inline array-literal receiver** of a `__tc_*` template helper (`[...].join(sep)`) now renders as a typed `std::vector<ElemType>{...}` so template deduction succeeds (was a bare `{...}` → "couldn't deduce template parameter 'T'"); the type-qualification is scoped to the method-receiver position only (a bare `{...}` is still correct for direct-init and HAL `Wire.write({...})`). **Sibling scan:** fix A's root cause (each renderer had its own inline partial string-escape) was found in **three more renderers** — `expression-renderer.ts` `inferFormatSpecifier` (the snprintf `%s` string-part path — CONFIRMED reachable via `${'x\ny'}` standalone interpolation), the async state-machine renderer, debug logpoints, and HAL param defaults — all now route through the one shared `escapeCppStringLiteral`. Families B/C/D scanned for siblings: no realistically-reachable gaps (B's remaining ungated ctors are out-of-scope "never" features like `WeakMap`; C's `.length` was already member-receiver-safe; D's `__tc_mapKeys/Values` deduction on an inline `new Map()` is non-idiomatic). Pinned by `tests/packages/transpiler/demo-29-regressions.test.ts` (11 tests). |
| #30 | Markdown flattener + word-frequency analyzer | (uncommitted) | idiomatic TS: a **markdown-to-plaintext flattener** (`class Markdown` walking lines, classifying by leading marker via a `const enum Block` + numeric `switch`, stripping markers and inline emphasis) plus a **word-frequency analyzer** (`class WordFreq` with a `Map<string, number>` tally + `string[]` insertion-order field + a `WordCount[]` struct array sorted by a hand-rolled selection sort), sharing one line-based model. Novel stresses: **chained string methods** (`freeFn(x).trim().toLowerCase()` whose intermediate result type the transpiler must resolve by walking the chain), `Set<string>` membership filtering, a `const enum` + `switch` with a **`case X: default:` fall-through** body, and `new Set([...])` constructor-with-initial-elements. **A/B/D/E all FIXED in the transpiler**, demo source in its natural idiomatic form, recompiles clean with correct output — (A) a free function called from a class method ONLY through a **lowered `raw` wrapper** (`freeFn(x).trim()` → `__tc_trim(freeFn(x))`) was missing from the class-method visibility set; `setup.ts` had its OWN hand-rolled IR walk that didn't extract identifiers from `raw` text (the canonical `collectStatementIdentifiers` DOES), so the function was emitted `static` with no header prototype → g++ "not declared in this scope" — fix: reuse the canonical walk, closing the divergence between two parallel walks (same blind-spot family as demo #22 B / demo #28 C, each in a different walk); (B) `.length` on a **`std::string`** now casts to `static_cast<long long>(s.length())` (was the bare unsigned `size_type`), and the snprintf specifier for `.length`/`.size` (both the `property-access` IR path and the lowered `raw`-node `static_cast<long long>(...size())` path) is now `%lld` to match — was hardcoded `%d`, tripping g++ -Wformat=; (D) a TS switch with **`case X: default: { body }`** (the fall-through-into-default idiom) lowered to an empty `if (x==X) {}` branch with the body only in the `else` — `x==X` ran nothing (silently wrong); the chain builder now groups consecutive empty-body cases with the next clause that has a body (OR-joining conditions), and a `default` in a group makes it the catch-all `else`; (E) **`new Set([...])` / `new Map([...])`** constructor-with-initial-elements DROPPED the initializer and emitted `{}` (empty container) — now renders the elements/entries into the brace-init-list. Pinned by `tests/packages/transpiler/demo-30-regressions.test.ts` (14 tests). |
| #31 | Roman numerals ↔ integer + English number-words converter | (uncommitted) | idiomatic TS: a **`class RomanNumerals`** (pure-static, no instance state) encoding/decoding integers 1–3999 via a **descending parallel-array value/symbol table** (`int32_t[]` + `string[]` indexed in lockstep — the classic C "struct-of-arrays" pattern, deliberately different from demos #15–#30 which leaned on `Map`/`struct[]`) plus a peek-2-char subtractive-pair decoder, and a **`class NumberWords`** composing `ONES_TEENS`/`TENS_PLACE` lookup tables into English phrases joined via `parts.join(' ')`. Novel stresses: **(a)** a `class`-method body that reads **indexed top-level const arrays** through a `parts.push(globalArr[i])` call (the array index sits inside a lowered `__RAW_STMT__` callee), **(b)** a `.join(sep)` on a `.push`-built `string[]`, **(c)** a `for (const r of TOP_LEVEL_STRING_ARR)` whose element type must flow into a template-literal format specifier, **(d)** a `static` class method called via `Cls.method(...)`. **A/B/C all FIXED in the transpiler**, demo source in its natural idiomatic form (no workarounds), recompiles clean with correct output (Roman round-trips + English spells both verified) — (A) a top-level `const` variable referenced ONLY from a class-method body through a lowered `__RAW_STMT__` callee containing an array index (`parts.push(ONES_TEENS[i])` → callee `__RAW_STMT__parts.push_back(ONES_TEENS[i])`, `args: []`) was tree-shaken — `collectStatementIdentifiers`' `call` case split the callee on `/->|::|[.(]/`, which stops splitting at `[` but NOT at `]`, so `"ONES_TEENS[i])"` survived as one compound token; the variable was emitted in NEITHER the .cpp definition NOR the .h extern → g++ "not declared in this scope" from the inline class-method body. Same blind-spot family as demo #22 B / demo #28 C / demo #30 A, each in a different walk; fix: when the callee is a `__RAW_STMT__` wrapper, scan its raw text with the SAME identifier regex the `raw` expression case uses, so every embedded identifier is collected regardless of bracket/paren structure (`ir/identifier-collector.ts`); (B) `.join(sep)` was misclassified in the STRING-method registry (`STRING_METHODS`), so on a `.push`-built `string[]` receiver (which `shouldLowerAsStringMethod` correctly rejects as a known array) BOTH the string path AND the vector value-method table declined the call → verbatim emit → g++ "no member named 'join'"; `__tc_join` is removed from `STRING_METHODS` and `join` added to `VECTOR_VALUE_METHOD_LOWERINGS` (the polyfill helper is still registered via `POLYFILL_HELPER_MAP['.join(']`) (`api/shared/string-method-registry.ts` + `ir/transformers/array-methods.ts`); (C) a `for (const r of GLOBAL_STRING_ARR)` whose iterable is a top-level `const` array resolved to `auto` (not `std::string`), and since a for-of var has no initializer the snprintf specifier picker couldn't recover the real type → defaulted to `%d` for a `std::string` → g++ -Wformat= + runtime garbage; `inferExprCppType` now consults `getCurrentIrTypeScope().globals` as a fallback for bare identifiers, matching what `resolveReceiverCppType` already does (`ir/type-resolution.ts`). **Sibling scan:** fix A's root cause (an under-tokenizing raw-text split) is a no-sibling recurrence of the demo #22/#28/#30 raw-wrapper blind-spot family — each walk is now individually patched because each has its own raw-text handling; the canonical `collectStatementIdentifiers` is the convergence point and is now used by `setup.ts` (demo #30 A) and patched for `__RAW_STMT__` callees here. Pinned by `tests/packages/transpiler/demo-31-regressions.test.ts` (14 tests). |
| #32 | Conway's Game of Life (toroidal 2D grid) | (uncommitted) | idiomatic TS: a **`class Life`** owning TWO double-buffered **`uint8_t[][]`** grids (`cur`/`nxt`, swapped each `step()` via a 3-way value swap) stepped by a **toroidal wraparound neighbor scan** (`(r+dr+rows)%rows` modular arithmetic in a nested `for` over `dr`/`dc`), classic patterns (block/blinker/glider) seeded from compact **`number[][]`** shape literals stamped onto the grid, a `const enum Cell`/`Transition` + numeric `switch` driving the birth/survival rules, and a `render()` building a multi-line frame via `parts.push` + `parts.join('\n')`. Novel stresses — the first demo to exercise **2D `T[][]` arrays** (a `vector<vector<T>>` CLASS FIELD with indexed read/write `this->cells[r][c]`), the **double-buffer swap** of two `T[][]` fields, a `number[][]` literal iterated and stamped, and the **enum↔integral storage boundary** in both directions. **A/B all FIXED in the transpiler**, demo source in its natural idiomatic form (no workarounds), recompiles clean with byte-for-byte identical correct output (verified against a reference JS implementation: population sequence 12, 11, 10, 13, 6) — (A) the **enum↔integral storage boundary** was one-way: the transpiler cast `enum→int` for comparisons/array-indices/`const n: number = enumVal`, but NOT for `this->cells[i] = enumVal` (enum→`uint8_t`), `const E x = arr[i]` (`uint8_t`→enum), `row.push(enumVal)` (enum→integral vector element via a raw `push_back` callee), or a ternary `(c ? Cell.Dead : Cell.Alive)` stored into integral storage. Root cause: a C++ `enum class` has NO implicit conversion to OR from integral; the three emit/IR-build sites each lacked the cast. Fix: a shared target-type-aware `renderValueForTarget` helper centralizes BOTH directions (enum→integral delegates to the existing `renderEnumSafeValue`; integral→enum casts to the enum type); the `assign` RHS and `var_decl` initializer route through it, the `.push` IR-build path casts the raw `push_back` arg, and a shared `INTEGRAL_CPP_TYPE_RE` (`emit/utils/cpp-helpers.ts`) replaces the divergent inline `isNumericTarget` regex. A companion fix made `inferExpressionCppType`'s property-access branch return the enum name for a numeric-enum member access (`Cell.Dead`→`Cell`) so wrapping exprs infer to the enum and the boundary fires (`emit/expression-renderer.ts` + `emit/statement-renderer.ts` + `ir/transformers/array-methods.ts`); (B) a program using `.join` (and ONLY `.join`) emitted the `__tc_join` polyfill (which uses `std::ostringstream`) without `#include <sstream>` — the `array_methods` polyfill block's `requiredIncludes` listed only `<algorithm>`/`<map>`, and prior `.join`-using demos compiled only because some OTHER polyfill (`__tc_toFixed` in `math_methods`) transitively pulled in `<sstream>`; a `.join`-only program got `std::ostringstream has incomplete type` + a 16-candidate `operator<<` cascade. Fix: `<sstream>` declared on the `array_methods` block (`framework-native/src/strategy.ts`). **No eslint/transpiler-check added** — both issues were transpiler bugs on fully-supported, idiomatic TS patterns (not unsupported user code), so a lint gate would wrongly reject legitimate code. Pinned by `tests/packages/transpiler/demo-32-regressions.test.ts` (10 tests). |




A "demo-driven fix" is a transpiler/lint change that a demo's compile failure
directly motivated, pinned by a regression test.

---

## 1. Variables & Types

### 1.1 Variable declarations

| Pattern | Status | Tested by |
|---|---|---|
| `let x = 1` | ✅ | #1, #3, #5, #6 |
| `const x = 1` | ✅ | #1, #3, #5, #6 |
| `var x = 1` | ❌ (gated) | #13 (lint rejects — use `let`/`const`) |
| `let x: number` (no initializer) | ✅ | #10 |
| Multiple decls `let a = 1, b = 2` | ✅ | #1, #6 |
| Declaration with typed initializer | ✅ | #4, #5, #6 |

### 1.2 Primitive type mapping

| Pattern | Status | Tested by |
|---|---|---|
| `number` → `double` | ✅ | all |
| `boolean` → `bool` | ✅ | #3, #4, #6 |
| `string` → `std::string` | ✅ | all |
| `void` → `void` | ✅ | all |
| `int` / `float` / `double` / `long` pass-through | ✅ | #4 |
| `uint8_t` / `int32_t` / `size_t` pass-through | ✅ | #4, #5, #6 |
| `bigint` | ❌ (unsupported) | — |

### 1.3 Numeric inference

| Pattern | Status | Tested by |
|---|---|---|
| Integer literal `42` infers `int` | ✅ | all |
| Float literal `3.14` infers `double` | ✅ | #3 (logistic growth) |
| `int` promoted to `double` (float init) | ✅ | #10 |
| `int` return promoted to `double` (float body) | ✅ | #12 |
| `int` return promoted to `long` (large enum) | ✅ | #4 (enum return widening) |
| Auto `uint8_t` vs `int16_t` selection | ❌ (future) | — |

### 1.4 Strings

| Pattern | Status | Tested by |
|---|---|---|
| `"literal"` | ✅ | all |
| Empty string `""` | ✅ | #6 |
| String + string concat | ✅ | all |
| String + number concat | ✅ | #1, #4, #6 |
| String + boolean concat | ✅ | #1 |
| Template literal `` `x = ${a}` `` | ✅ | #1, #6 |
| Nested template literals | ✅ | #10 |
| Tagged template | ❌ (unsupported) | — |
| `string` → `std::string` everywhere | ✅ | all |

### 1.5 Arrays & collections

| Pattern | Status | Tested by |
|---|---|---|
| `number[]` → `std::vector<double>` | ✅ | #1, #2, #3 |
| `Array<T>` → `std::vector<T>` | ✅ | #3 |
| `ReadonlyArray<T>` | ✅ | #8 |
| `new Uint8Array([...])` / typed arrays | ✅ | #5 |
| `new Float32Array(n)` zero-init | 🟡 | #12 (works inside a function; top-level local gets extern float* vs float[] mismatch — Finding D) |
| Typed-array annotation → pointer | ✅ | #5 |
| `.length` on typed array | ✅ | #5 |
| Array literal `[1, 2, 3]` | ✅ | all |
| Spread in array `[...a, b]` | ✅ | #8 |
| Mutable array methods (`push`/`pop`/`indexOf`) | ✅ | #1, #2, #3, #4; **#22 fix A — `.pop`/`.push` on an instance-field receiver (`this.ops.pop()`) now lower correctly** |
| `[T]` tuple type | ✅ | #8 (fix F — alias-to-tuple now emits `using`; tuple-literal caveat remains) |
| `Map<K,V>` / `ReadonlyMap` | ✅ | #5, #6, #15; **#30 fix E** (`new Map([[k,v]])` initializer no longer dropped → `{}`) |
| `Set<T>` / `ReadonlySet` | ✅ | #6, #15 (const Set mutated via .add() demoted); #16 (fix B — demotion is now scope-local, so a read-only const Map is not demoted due to a sibling function's same-named binding); #17 (demotion now reaches class methods/getters/setters/ctors + namespace functions, not just free functions); **#30 fix E** (`new Set([...])` initializer no longer dropped → `{}`) |
| `Record<K,V>` | 🟡 | #8 (as a field type works; object-literal init into a Record is Finding G) |
| 2D arrays `T[][]` | ✅ | #9, #32 |
| Associative array access `obj["key"]` | ❌ (gated) | #13 (lint `no-dynamic-property-access`; use a Map) |
| Heterogeneous array literal | ❌ (build error) | — |
| `any` annotation | ❌ (build error) | — |

### 1.6 Objects, interfaces, type aliases

| Pattern | Status | Tested by |
|---|---|---|
| Object literal `{ a: 1, b: 2 }` | ✅ | all |
| Object with spread `{ ...a, b: 2 }` | ❌ (gated) | #11 (lint `ObjectExpression > SpreadElement` — C++ structs have fixed shape; construct field-by-field) |
| `interface Foo { ... }` → `struct` | ✅ | #3, #4, #5, #6 |
| Interface with index signature | 🟡 | #13 (lowers to std::map field; obj["key"] gated; use Map.get) |
| Interface with numeric keys | 🟡 | #13 (lowers to std::map; Map.get return is `auto` — Finding H) |
| `type Foo = { ... }` | ✅ | #4 |
| `type Foo = SomeOther` (alias) | ✅ | #4 |
| `type Foo = number` | ✅ | #7 (fix E — emits `using`, survives tree-shaking) |
| `implements Interface` | 🟡 | #4 (recorded, not enforced) |
| `new SomeInterface()` | ❌ (build error) | — |
| Discriminated union of object literals → `std::variant` | ❌ (gated) | #9 (fix A — `<variant>` include registered; member access gated out — `TS2CPP_UNION_MEMBER_ACCESS`; use a struct) |
| `keyof T` | ❌ (gated) | #11 (lint `TSTypeOperator[type='keyof']` — no C++ equivalent; use a string union or switch) |
| Indexed access type `T[K]` | ❌ (gated) | #11 (lint `TSIndexedAccessType` — use the concrete field type directly) |
| Conditional type | 🟡 | #13 (Finding D — leaks generic `T`; don't use in value positions) |
| Mapped type | 🟡 | #13 (Finding E — leaks generic `T`) |
| Template literal type | ❌ (unsupported) | — |
| `satisfies` operator | ✅ | #8 (type-only, erased) |
| `as const` | 🟡 | #4 (object — F12 fix); #6 header note only |

### 1.7 Enums

| Pattern | Status | Tested by |
|---|---|---|
| Numeric enum `enum E { A, B }` | ✅ | #1, #4 |
| Enum with explicit values | ✅ | #6 (StationKind) |
| `const enum` | ✅ | #5, #6, #15 |
| Mixed explicit/implicit values | ✅ | #6 (StationKind computed) |
| String enum | ✅ | #4 (GameStatus, Outcome) |
| Enum relational comparison | ✅ | #4; fix in #3 (enum arithmetic `-`) |
| Enum value as array index (`arr[op]`) | ✅ | #28 (fix E — cast to `static_cast<int>(op)`; enum class doesn't implicitly convert to `size_t`) |
| Enum ↔ integral storage boundary (`this->cells[i] = enumVal`, `const E x = arr[i]`, `row.push(enumVal)`, ternary of enums → integral storage) | ✅ | #32 (fix A — both directions now centralized in `renderValueForTarget`; enum class has no implicit conversion to OR from integral) |
| Enum type preserved across decls/returns | ✅ | #6 (Material field/param) |
| `enum` nested inside function/class | ⬜ | |
| Enum → number implicit cast (G10) | ✅ | #1 (drove fix) |
| Bitwise ops on enum operands (`& \| ^ <<`) | ✅ | #5 (drove fix) |

### 1.8 Null, undefined, and optionality

| Pattern | Status | Tested by |
|---|---|---|
| `T | null` / `T | undefined` → `T` | ✅ | #9 (fix D — value-type `=== null` resolves to false; erasure works) |
| `T | null | undefined` → `T` | ✅ | #13 (erases to T; null comparison resolved to false per #9 fix D) |
| Optional field `x?: T` → `T` | 🟡 | #6 (lint-guarded: B; compares-to-undefined is now an error) |
| Non-nullish same-kind union (narrowed enum / string-literal union) | ✅ | **#22 fix C** — coalesces to single primitive type (no false `TS2CPP_UNCLASSIFIABLE_TYPE`); heterogeneous `number\|Point` still warns |
| `null` literal → `nullptr` | ✅ | #9 |
| `undefined` literal → `CUTTLEFISH_UNDEFINED` | ✅ | #9 |
| `a ?? b` nullish coalescing | ✅ | #4 (F6 helper-from-header fix) |
| `a?.b` optional chaining | ✅ | #7 |
| `a?.()` optional call | 🟡 | #7 (fix N — guard emitted; empty-std::function detection still a runtime gap) |
| `a ??= b` logical nullish assignment | ✅ | #8 (fix I — property-access left side now handled) |
| True `Optional<T>` / `std::optional` | ❌ (future) | — |

### 1.9 Destructuring

| Pattern | Status | Tested by |
|---|---|---|
| Object destructure `const { a, b } = obj` | ✅ | #5; fix in #6 (D — scope hoist) |
| Renamed `{ a: x }` | ✅ | #7 |
| Default `{ a = 5 }` | ✅ | #7 |
| Nested object destructure | 🟡 | #6 (fix D covers nested too, but demo doesn't use it) |
| Array destructure `const [a, b] = arr` | ✅ | #7 |
| Array destructure default | 🟡 | #8 (Finding I — wrong runtime value; default not bound when element absent) |
| Rest element `const [a, ...rest]` | ✅ | #7 (fix D — vector<T> not vector<T&>) |
| Destructure without initializer | ❌ (unsupported) | — |
| Parameter destructure `function f({ a, b })` | ✅ | #7 |
| Mixed destructure + regular params | ✅ | #8 |

### 1.10 Type assertions & narrowing

| Pattern | Status | Tested by |
|---|---|---|
| `x as T` | ✅ | #4 |
| `<T>x` angle-bracket assertion | ✅ | #10 (type-only, erased) |
| `x!` non-null assertion | ✅ | #5, #6 |
| `typeof x` | ✅ | #10 (fix C — int32_t family returns "number"; was "object") |
| `typeof` type guard optimization | 🟡 | #13 (union narrowing gated; typeof returns correct string per #10 fix C) |
| `instanceof` | ❌ (gated) | #13 (lint `BinaryExpression[operator='instanceof']` — no RTTI) |
| `in` operator (`"k" in obj`) | ✅ | #7 (fix K — enum keys cast) |

### 1.11 Generics

| Pattern | Status | Tested by |
|---|---|---|
| Generic function `function f<T>(x: T)` | ✅ | #6 (F fix: def in header) |
| Multiple type params | ✅ | #8 (`Registry<K extends string|number|symbol, V>`) |
| Generic class `class C<T>` | 🟡 | #8 (template + fields emit; `extends Generic<T>` fixed — Finding A; static members + `new Generic<T>()` static access still gap — Finding B/C) |
| Generic constraint `T extends X` → `static_assert` | ✅ | #6 (`complexity<T extends Recipe>`) |
| Generic type param in scope | ✅ | #6 |
| Conditional/`infer` generic gymnastics | ❌ (unsupported) | — |

### 1.12 Top type erasure

| Pattern | Status | Tested by |
|---|---|---|
| `any` | ❌ (build error) | — |
| `unknown` | ✅ | #11 (catch param — erases; catch emits catch(...)) |
| `never` | ❌ (unsupported) | — |
| `Partial<T>` / `Required<T>` / `Readonly<T>` / `Pick` / `Omit` | 🟡 | #10 (fix A — alias survives + emits after interface; resolves to full struct T — Partial/Pick/Omit don't narrow the C++ shape) |
| `NonNullable<T>` | 🟡 | #12 (alias emits; value reads as 0 at runtime — Finding F) |
| `ReturnType`/`Parameters`/`InstanceType`/`Extract`/`Exclude` | 🟡 | #13 (Finding F — `typeof` in type position broken; don't use) |

---

## 2. Control Flow

### 2.1 Conditionals

| Pattern | Status | Tested by |
|---|---|---|
| `if` | ✅ | all |
| `if / else` | ✅ | all |
| `if / else if / else` chains | ✅ | #1, #4, #6 |
| Nested `if` | ✅ | #4 |
| Ternary `a ? b : c` | ✅ | #4, #5, #6 |
| Nested ternary | ✅ | #7 |
| Ternary string vs numeric branches | ✅ | #6 (verdict) |

### 2.2 Loops

| Pattern | Status | Tested by |
|---|---|---|
| `for (let i; cond; inc)` C-style | ✅ | all |
| `for (const i; ...)` | ✅ | #6 |
| Infinite `for (;;)` | ✅ | #11 |
| `for...of` over array | ✅ | #1, #3, #4, #6, #17 |
| Nested `for...of` | ✅ | #4 |
| `for...of` loop variable mutated in body (const → T&) | ✅ | #17 (fix A — const loop var mutated via `t.field=`/`t[i]=`/`t.field++` now demotes to a non-const reference, in all scopes incl. class methods/namespaces; new lint rule `no-readonly-loop-variable-mutation`) |
| `for...in` over object keys | 🟡 | #7; over a Map/Record now rejected (semantic gate TS2CPP_FORIN_ON_MAP); plain-object for-in untested end-to-end |
| `while` | ✅ | #3, #4 |
| `while` with `break`/`continue` | ✅ | #3 |
| `do...while` | ✅ | #5, #6 |
| Infinite `while (true)` | ✅ | #12 |
| `for await...of` | ❌ (unsupported) | — |
| `for...of` by-reference for class elements | ✅ | #6 (H fix — clears warning) |

### 2.3 Branch control

| Pattern | Status | Tested by |
|---|---|---|
| `break` | ✅ | #3, #4 |
| `continue` | ✅ | #3 |
| `break` in switch | ✅ | #4, #6 |
| Labeled break `outer:` | ✅ | #4 (F9 goto fix) |
| Labeled continue | ✅ | #9 |
| Labeled statement (general) | ✅ | #9 |
| Empty statement `;` | ✅ | #9 |
| Standalone block `{ ... }` | ✅ | #12 |

### 2.4 `switch`

| Pattern | Status | Tested by |
|---|---|---|
| `switch` with cases | ✅ | #4, #6 |
| `default` | ✅ | #4, #6 |
| Switch without default | ✅ | #10 |
| Multiple statements per case | ✅ | #4 |
| Variable in case expression | ✅ | #12 |
| Nested switch | ✅ | #11 |
| **Braced case bodies** (`case X: { ...; break; }`) | ✅ | #28 (fix D — break stripped for braced cases too when lowered to if/else; was kept → broke enclosing loop / hard g++ error) |
| Fall-through into a SHARED body (`case A: case B: body`, `case X: default: body`) | ✅ | #30 (fix D — empty-body cases grouped with the next clause that has a body; conditions OR-joined; a `default` in the group makes it the catch-all `else`. Was: empty `if (x==X) {}` branch, body only in `else` → `x==X` ran nothing) |
| Fall-through with side effects (non-empty body, no break) | 🟡 | #6 (case groups, 2:3:) — emitted verbatim, relies on C++ fall-through semantics |
| String `switch` | ✅ | #7 (dispatch) |
| `switch` on enum/numeric **struct field** (`switch (m.unit)`) | ✅ | #16 (fix A — type-aware discriminant, no `std::string(enum)` wrap) |

### 2.5 Exceptions

| Pattern | Status | Tested by |
|---|---|---|
| `try / catch` on native/ESP32 | ✅ | #6 |
| `try / catch` on AVR | ❌ (error) | — |
| `try / catch / finally` | ✅ | #11 (fix E — catch emits catch(...) catch-all) |
| `throw` on AVR | ❌ (error) | — |
| `throw` on native/ESP32 | ✅ | #11 |
| Custom error classes / `Error` subclass | ❌ (unsupported) | — |

### 2.6 Async & concurrency

| Pattern | Status | Tested by |
|---|---|---|
| `async function` | ❌ (gated) | #13 (lint rejects — no event loop) |
| `await expr` | ❌ (gated) | #13 (lint rejects) |
| `await` on a statement | ❌ (gated) | #13 |
| `Promise`, `Promise.all`, `.then` | ❌ (unsupported) | — |
| `function*` generator | ❌ (gated) | #13 (lint rejects — no coroutine runtime) |
| `yield` / `yield*` | ❌ (gated) | #13 |

---

## 3. Functions

### 3.1 Declarations

| Pattern | Status | Tested by |
|---|---|---|
| `function f() {}` declaration | ✅ | all |
| Named function expression | ✅ | #7 (lossLabel) |
| Arrow function `const f = () => {}` | ✅ | #6 (callback) |
| Arrow with expression body | ✅ | #6 |
| Anonymous declaration export | ❌ (unsupported) | — |
| Nested function declaration | ✅ | #4 |
| Nested class inside function | 🟡 | #13 (Finding J — emits `auto` params; hoist to module level) |
| Recursion | ✅ | #4 (pathfinding) |
| Function hoisting (sibling calls) | ✅ | #1, #4 |
| `export function` | ✅ | all |
| `export default function` | 🟡 | #12 (export emits; default import doesn't resolve — Finding C; use named export) |

### 3.2 Parameters

| Pattern | Status | Tested by |
|---|---|---|
| Primitive params | ✅ | all |
| Multiple params | ✅ | all |
| Default param `function f(a = 5)` | ✅ | #6 (Stockpile ctor) |
| Rest param `function f(...xs)` → `std::vector<T>` | 🟡 | #6 (declaration OK; call-site spread fixed, literal-args call needs signature table) |
| Object destructure param | 🟡 | #13 (Finding A — inline type emits `auto`; use named interface) |
| Nested object destructure param | 🟡 | #13 (same — use named interfaces) |
| Array destructure param | ✅ | #13 |
| Mixed destructure + regular params | ✅ | #8 |
| `this` parameter (typed) | 🟡 | #13 (type-only, erased; not exercised in a class method body) |

### 3.3 Return types & overloads

| Pattern | Status | Tested by |
|---|---|---|
| Annotated return type | ✅ | all |
| Inferred return type | ✅ | all |
| Multiple `return`s with differing types | ✅ | #4 |
| Early return | ✅ | #4 |
| Return type with ownership wrapper | ✅ | #4 |

### 3.4 Higher-order functions & callbacks

| Pattern | Status | Tested by |
|---|---|---|
| Passing function as argument → `std::function` | ✅ | #6 (Forge.report) |
| Returning a function | ✅ | #9 (fix B — nested-fn alias mangling; capture-free nested fns work; capturing nested fns are the §3.4 closure limit) |
| Function type alias `type Fn = () => void` | ❌ (gated) | #9 (lint rejects — not emitted as C++ typedef) |
| Class method as callback | ❌ (gated) | #9 (`.bind()` rejected — no `this`-rebinding in C++) |
| `Math.method` callbacks (comparator) | ✅ | #13 (module-level comparator; sort convention fixed in #12) |
| Closures capturing outer variables | 🟡 | #6 (named function + module-level offset; arrow-capture unreliable) |
| IIFE `(function(){})()` | ❌ (unsupported) | #7 (gated out — fix M, lint selector) |
| Arrow callback with explicit return type → ISR | ✅ | #6 (G fix); #7 (fix A — param cppType now resolved too) |

### 3.5 `forEach` inline expansion

| Pattern | Status | Tested by |
|---|---|---|
| `arr.forEach(fn)` as statement | 🟡 | #12 (not lowered on runtime vectors — callback ISR can't capture locals; use a manual for loop) |
| `forEach` with arrow expression body | 🟡 | #13 (not lowered — use manual for loop) |
| `forEach` with block body | 🟡 | #13 (same gap) |

---

## 4. Classes & OOP

### 4.1 Class structure

| Pattern | Status | Tested by |
|---|---|---|
| `class C {}` empty | ✅ | #13 |
| Class with public/private/protected fields | ✅ | #2, #3, #4, #6 |
| Class with field initializers | ✅ | #2, #4, #6 |
| Class with `readonly` fields | ✅ | #3, #6 |
| Class with `static` fields/methods | ✅ | #4, #6 |
| Static initializer block `static { ... }` | ❌ (gated) | #13 (lint `StaticBlock` — no C++ lowering; init in field decl or ctor) |
| Optional class field `x?: T` | ✅ | #4 |
| Generic class `class C<T>` | 🟡 | #8 (template + fields emit; `extends Generic<T>` fixed — Finding A; static members + `new Generic<T>()` static access still gap — Finding B/C) |
| Nested class (inside function or class) | 🟡 | #13 (Finding J — nested class in function emits `auto`; hoist to module level) |
| `export class` / `export default class` | ✅ | all |

### 4.2 Constructors & `this`

| Pattern | Status | Tested by |
|---|---|---|
| `constructor()` | ✅ | #2, #4, #6 |
| Constructor default param | ✅ | #6 (Stockpile) |
| Constructor parameter property | ✅ | #4 |
| `this.field = value` assignment | ✅ | #2, #4, #6 |
| `this.x += value` compound | ✅ | #6 |
| `this` reference → `this->` | ✅ | all |
| `this` in free function | ❌ (unsupported) | — |

### 4.3 Methods

| Pattern | Status | Tested by |
|---|---|---|
| Instance method | ✅ | #2, #3, #4, #6 |
| Private/protected method | ✅ | #6 (craft) |
| Static method | ✅ | #4, #6 (Stockpile.format) |
| Method calling free function | ✅ | #4; **#22 fix B** — call sites nested in a parenthesized sub-expression no longer get tree-shaken; **#30 fix A** — a free fn reached only through a lowered `raw` wrapper (`freeFn(x).trim()`) is now visible to the class-method visibility walk (was its own hand-rolled walk that missed `raw` text → emitted `static` + no header prototype → g++ "not declared in this scope") |
| Getters `get x()` | ✅ | #4, #6 (C fix: pointer receiver); #14 (instance + cross-file access now rewrites to getX()) |
| Setters `set x(v)` | ✅ | #6 |
| Getter/setter pair | ✅ | #6 |
| Static getter/setter | ✅ | #8 (fix B — cv-qualifier dropped); #14 (fix E — `Cls.x` now rewrites to `Cls::getX()`; access-name caveat resolved) |
| Abstract method → pure virtual | ✅ | #6 (Workstation.produces) |

### 4.4 Inheritance & polymorphism

| Pattern | Status | Tested by |
|---|---|---|
| `class B extends A` | ✅ | #4, #6 |
| `super()` call → initializer list | ✅ | #4, #6 |
| `super` with args | ✅ | #6 (StationKind arg) |
| `super.method()` | 🟡 | #8 (lowering attempted; cascades from generic-subclass emit — Finding A/B) |
| Virtual method override (polymorphism) | ✅ | #4, #6 (Smelter/Assembler.craft) |
| Virtual destructor on polymorphic base | ✅ | #4, #6 |
| `override` modifier | ✅ | #6 |
| Abstract class with abstract methods | ✅ | #6 (Workstation) |
| Multiple inheritance | ❌ (unsupported) | — |
| Mixins | ❌ (unsupported) | — |

### 4.5 Reference vs value semantics

| Pattern | Status | Tested by |
|---|---|---|
| `new C()` returns pointer | ✅ | #4, #6 |
| Field of class type → pointer field | ✅ | #4, #6 (Forge.storage) |
| **Self-referential pointer fields** (`prev`/`next: C \| null`) | ✅ | #25 (doubly-linked-list `Entry`; explicit pointer-field writes through non-`this` local receivers `n.next = x; x.prev = n` lower correctly — no `->`/`.` confusion, no dropped member writes) |
| Local `let s = this.pointerField` | ✅ | #4 |
| Deep access chain `a.b.c.d` | ✅ | #4, #6 |
| `for (const item of classArray)` → `item->field` | ✅ | #6 |
| Constructor param promoted to pointer | ✅ | #4 |
| Borrowed constructor param (not deleted) | ✅ | #13 |

### 4.6 Ownership wrappers

| Pattern | Status | Tested by |
|---|---|---|
| `Owned<T>` field | ✅ | #8 |
| `Shared<T>` field | ✅ | #8 |
| `Mutable<T>` field | ✅ | #8 |
| Wrapper detection before alias resolution | 🟡 | #13 (Finding I — `type X = Owned<T>` resolves to `auto` field; use Owned<T> directly) |

### 4.7 Decorators & namespaces

| Pattern | Status | Tested by |
|---|---|---|
| Class decorator `@dec class C` | ❌ (gated) | #13 (lint rejects — no lowering) |
| Method/property/parameter decorators | ❌ (unsupported) | — |
| Decorator factories `@dec(arg)` | ❌ (gated) | #13 |
| `namespace X {}` | ❌ (gated) | #11 (no ModuleDeclaration lowering — `TSModuleDeclaration` lint selector; use a class with static methods) |
| Enum inside class | 🟡 | #13 (use static readonly constants instead — enum-inside-class untested) |
| Interface inside class/function | 🟡 | #13 (hoist to module level) |
| Type alias inside class/function | 🟡 | #13 (hoist to module level) |

---

## 5. Expressions & Stdlib

### 5.1 Operators

| Pattern | Status | Tested by |
|---|---|---|
| Arithmetic `+ - * / %` | ✅ | all |
| Comparison `== != < > <= >=` | ✅ | all |
| Logical `&& \|\| !` | ✅ | #4, #6 |
| Bitwise `& \| ^ ~ << >>` | ✅ | #4, #5, #6 |
| Compound assignment `+= -= *= /= %=` | ✅ | #3, #6 |
| Bitwise assignment `&= \|= ^= <<= >>=` | ✅ | #5 |
| `\|\|=`, `&&=`, `??=` | ✅ | #8 (??= fixed); #13 (fix C — ||=,&&= on property access now lowered) |
| Prefix/postfix `++ --` | ✅ | #4 |
| Comma operator `(a, b)` | ✅ | #8 |
| Unary `-x`, `+x`, `!x` | ✅ | #4 |
| `delete obj.key` | ✅ | #8 (fix D — Map.delete method now lowers to .erase) |
| `void expr` | ✅ | #8 |
| Exponentiation `**` | 🟡 | #8 (use Math.pow — `**` is matrix-🟡) |
| `new.target`, `import.meta` | ❌ (unsupported) | — |

### 5.2 `Math.*`

| Pattern | Status | Tested by |
|---|---|---|
| `Math.floor/ceil/round/abs/sqrt/...` | ✅ | #2, #3, #5, #6 |
| `Math.min/max` | ✅ | #4, #6 |
| `Math.random` | ✅ | #7 |
| `Math.PI`, `Math.E`, constants | ✅ | #7 (fix L — lower to literals) |

### 5.3 Array & string methods

| Pattern | Status | Tested by |
|---|---|---|
| `push`, `pop` | ✅ | #1, #2, #3, #4, #6; **#22 fix A — on an instance-field receiver (`this.ops.pop()`)** |
| `indexOf`, `lastIndexOf`, `includes` | ✅ | #7 (includes) |
| `shift`, `unshift`, `splice`, `sort`, `reverse`, `fill`, `concat`, `slice`, `join` | ✅ | #7 (sort, slice, join); #10 (shift, unshift, reverse, fill, concat); #12 (fix E — sort-with-comparator convention fixed); slice on a number[] still resolves to the string __tc_slice2 polyfill (guard-collision gap) |
| `map`, `filter`, `reduce`, `find`, `findIndex`, `every`, `some`, `forEach` | ✅ | #4 (F7 filter); #7 (map/filter/reduce/some/find — fix A: callbacks carry real signatures); forEach on runtime vector still a gap |
| `.length` on array/string/typed-array | ✅ | all; **#22 fix F** (`.length` on Map/Set field → `.size()`); **#27 fix C** (`.length` on local vector → `static_cast<long long>(x.size())`); **#30 fix B** (`.length` on `std::string` → `static_cast<long long>(s.length())`; snprintf `%lld` for `.length`/`.size`) |
| String methods (toUpperCase, etc.) | ✅ | #2 |
| `parseInt`, `parseFloat` | ✅ | #9 (fix C — `.c_str()` for `atoi`/`atof`) |

### 5.4 `Object.*` and container ops

| Pattern | Status | Tested by |
|---|---|---|
| `Object.keys(map)` | ✅ | #7 (fix I — member-access args resolved) |
| `Object.values(map)` | ✅ | #7 (fix I) |
| `Object.entries(map)` | 🟡 | #7; pair→tuple return-type mismatch remains |
| `Object.keys(plainStruct)` | 🟡 | #4 (F5 — only literal field names) |
| `Object.assign`, `Object.freeze`, `Object.fromEntries` | ❌ (unsupported) | — |
| `JSON.*` | ❌ (unsupported) | — |
| `String.*` statics (`fromCharCode`/`fromCodePoint`/`raw`) | ❌ (gated + build error) | #28 (fix A — lint gate + build-time `TS2CPP_NO_EQUIVALENT`; was neither lowered nor gated → silent g++ error) |
| `Number.*` statics (`parseInt`/`parseFloat`/`isFinite`/`isNaN`/...) | ❌ (gated + build error) | #28 (fix A) |

### 5.5 HAL / hardware-specific

| Pattern | Status | Tested by |
|---|---|---|
| `new Pin(n)`, buses, ports | ⬜ | (native demos only — no HAL demo yet) |
| Pin factory functions | ⬜ | |
| `pin.read()`, `pin.write()`, bus methods | ⬜ | |
| `spi.device(cs).transfer(...)` | ⬜ | |
| `registerPlatformStrategy(...)` | ⬜ | |

---

## 6. Module structure

### 6.1 Top-level file model

| Pattern | Status | Tested by |
|---|---|---|
| Free functions emit as C++ free functions | ✅ | all; **#28 fix C — a free function called only as a nested argument (`out.push(glyphFor(op))`) survives tree-shaking (the `__RAW_STMT__` call wrapper's inner callee is now collected)** |
| Top-level statements flow into `main()` / `setup()` | ✅ | all; **#28 fix B — a promoted (runtime + free-function-referenced) top-level variable's file-scope default initializer is `{}` not `= 0` (valid for class types)** |
| `setup()` / `loop()` Arduino entry points | ⬜ | |
| Split-file emission (non-entry files) | ✅ | #4, #5, #6 (A fix: extern for const arrays) |
| Source maps (C++ → TS error mapping) | ⬜ | |
| `.ino` sketch flattening for Arduino | ⬜ | |

### 6.2 Imports / exports

| Pattern | Status | Tested by |
|---|---|---|
| `import { x } from "./local"` | ✅ | all |
| `import x from "./local"` (default) | 🟡 | #12/#13 (named export works; inline default function not processed — Finding C; use named export) |
| `import { x } from "npm-pkg"` | ✅ | #4 (@typecad/expect) |
| `import @typecad/expect` | ✅ | #4 |
| `export` / `export default` | ✅ | all |
| Native `.d.ts` + `.cpp` binding pairs | ⬜ | |
| Dynamic `import()` | ❌ (unsupported) | — |
| `require()` | ❌ (unsupported) | — |
| Re-exports `export * from` | 🟡 | #13 (Finding G — re-exported symbols not visible to importer; import directly from source) |

---

## Summary

**Coverage counts** (approximate, ✅ items only):

| Section | ✅ Tested | ⬜ Untested | ❌ Unsupported |
|---|---|---|---|
| 1. Variables & Types | 41 | 33 | 7 |
| 2. Control Flow | 22 | 16 | 4 |
| 3. Functions | 20 | 14 | 1 |
| 4. Classes & OOP | 27 | 16 | 2 |
| 5. Expressions & Stdlib | 18 | 18 | 3 |
| 6. Module structure | 5 | 5 | 2 |
| **Total** | **133** | **102** | **19** |

**Demo-driven fixes catalog** (transpiler/lint changes a demo's compile failure
motivated, pinned by regression tests):

| Demo | Fixes | Test file |
|---|---|---|
| #1 | G10 (enum→number cast) | `tests/demo-driven-fixes.test.ts` (G1–G10) |
| #2 | string-enum + enum-concat lowering; bug-fix batch | (in `tests/bug-fixes.test.ts`) |
| #3 | enum arithmetic (`-`) on enum-class operands | (in `tests/demo-driven-fixes.test.ts`) |
| #4 | F1–F12 (Map/Set type-arg leak, cstdint, static field, enum == cast, Object.keys on class, ?? helper, .filter, let→const array, labelled break goto, generic call-site T, object brace-init, as const); lint `no-undefined-compare-on-get` | `tests/packages/transpiler/demo-4-regressions.test.ts` |
| #5 | bitwise ops on enum operands; lint `no-typed-array-param-length`, `no-typed-array-return` | `tests/packages/transpiler/demo-5-regressions.test.ts` |
| #6 | A (extern for const arrays), C (getter via pointer), D (destructure scope), E (rest spread call), F (generic def in header), G (callback return type), H (for...of by-ref); lint `no-undefined-compare-on-struct-field` | (pins removed in 8d64d401) |
| #7 | A (functional-method callback signatures: .map/.filter/.reduce/.some), D (array-rest `vector<T&>`→`vector<T>`), E (type-alias-to-primitive emitted as `using`), G (const-local struct mutation demoted), I (Object.keys/values on member-access + lint broadened), J (`for...in` over Map gated: `TS2CPP_FORIN_ON_MAP`), K (enum keys into Map `static_cast`), L (`Math.PI`/`E` literals), M (IIFE gated), N (optional call `fn?.()` null guard); broadened `no-object-static-non-map` lint rule | `tests/packages/transpiler/demo-7-regressions.test.ts` |
| #8 | A (generic subclass `extends Generic<T>` heritage type args resolved), B (static getter `const` cv-qualifier dropped), D (`m.delete(k)` Map method → `.erase`, not `delete_`), F (tuple/container type-alias survives tree-shaking), H (`Map.size` → `m.size()`, not `m->size`), I (`??=` on property-access left side); E/G/C documented (shadow-struct collision, index-sig literal, static-getter access name, tuple literal) | `tests/packages/transpiler/demo-8-regressions.test.ts` |
| #9 | A (discriminated union → `std::variant` registers `#include <variant>`), B (nested-fn return reference alias-mangled), C (`parseInt`/`parseFloat` `.c_str()`), D (`T\|null` value-type comparison → false), E (union member access gated: `TS2CPP_UNION_MEMBER_ACCESS`); F documented (`bind\|call\|apply` lint guardrail) | `tests/packages/transpiler/demo-9-regressions.test.ts` |
| #10 | A (utility-type aliases `Partial`/`Pick`/`Omit` survive tree-shaking + interfaces emit before aliases), C (`typeof` on int32_t returns "number" not "object"); B documented (Partial→full struct shape) | `tests/packages/transpiler/demo-10-regressions.test.ts` |
| #11 | E (`try/catch` emits `catch(...)` catch-all — was `catch(const std::exception&)` which missed thrown non-exception types), D (array-of-objects with a named element type uses the named type, not a shadow `_{name}_t` struct); A/B/C gated (`ObjectExpression > SpreadElement`, `TSTypeOperator[type='keyof']`, `TSIndexedAccessType`, `TSModuleDeclaration` lint selectors) | `tests/packages/transpiler/demo-11-regressions.test.ts` |
| #12 | E (`.sort(comparator)` convention — TS negative=before converted to std::sort true=before); A/B/C/D/F documented (forEach, in-class sort ordering, export default inline fn, Float32Array extern, NonNullable snprintf) | `tests/packages/transpiler/demo-12-regressions.test.ts` |
| #13 | C (`\|\|=`/`&&=` on property-access left sides lowered), B/D/E/F gated (static-init block, conditional types, mapped types, ReturnType/Parameters — lint selectors); G/H/I/A/J documented (re-exports, Map.get auto, wrapper-on-alias, inline-type auto, nested-class-in-fn) | `tests/packages/transpiler/demo-13-regressions.test.ts` |
| #14 | A (struct-return-of-null/`?? null` lowers to `return {};` — `ReturnIR.functionReturnType`, free fns AND methods), B (subclass with no ctor gets a synthesized forwarding ctor), D (free fns forward-declared BEFORE class bodies), E (static-getter `Cls::getX()` rewrite + cross-file accessor aggregation), G (`int32_t`→`%d`, `uint32_t`→`%u`, not `%ld`); C lint-gated (`no-map-struct-mutation` — no TS→C++ reference binding for map values), F stale `TS2CPP_NO_EQUIVALENT` string-enum warning removed | `tests/packages/transpiler/demo-14-regressions.test.ts` |
| #15 | A (`Map.values()`/`.keys()`/`.entries()` and `Set.values()`/`.entries()` lower to `__tc_mapValues`/`__tc_mapKeys`/`__tc_mapEntries`/`__tc_setValues`/`__tc_setEntries` helpers — was: `.values()` dropped, for-of iterated raw `std::pair` entries), B (`Map.get(k)` lowers to const-correct `m.at(k)` — was: non-const `operator[]`, failed on a const-bound Map and silently inserted on miss), C (const-bound `Map`/`Set` mutated via `.set()`/`.add()`/`.delete()` now demoted; `insert`/`erase` added to mutation set; index-assignment marks `let` vars `everAssigned` so the contradictory `ownership-suggest-const` no longer fires); D documented (`const enum` lint-gated in scaffolded projects). New lint rule `no-mutating-method-on-const-collection` (warn) persists into new projects. | `tests/packages/transpiler/demo-15-regressions.test.ts` |
| #16 | A (`switch` on a property-access discriminant — e.g. `switch (m.unit)` on an enum/numeric struct field — is now type-aware: the `std::string(...)` wrap is decided by the discriminant's resolved C++ type via a new public `inferCppType` on the expression renderer, so enum/numeric fields emit a plain comparison instead of the illegal `std::string(enum)`; was: property-access wrapped unconditionally → `no matching function for call to 'std::string::basic_string(const Unit&)'`), B (ownership const-content demotion is now resolved **per lexical scope** in a single combined pass with scope-local maps — was: two separate global passes over flat name-keyed maps, so a read-only `const` Map in one function collided with a same-named binding mutated in a sibling function and was wrongly demoted; cross-scope `let` reassignment still suppresses `ownership-suggest-const` via a program-wide assigned-names set). No new lint rule (compile-time fixes). | `tests/packages/transpiler/demo-16-regressions.test.ts` |
| #21 | C (typed-array **class field** is now rejected by a new semantic gate `TS2CPP_TYPED_ARRAY_FIELD` + lint `no-typed-array-field` — a `private buf: Uint8Array` field lowered to `uint8_t*` whose `new Uint8Array(N)` initializer lowers to a brace-init-list `{uint8_t(N)}` that cannot initialize a pointer, with no `new[]`/`delete[]` lifecycle; this closes the last ungated storage class for typed arrays, consistent with the existing `TS2CPP_TYPED_ARRAY_RETURN` / `TS2CPP_TYPED_ARRAY_PARAM_LENGTH` boundary: typed arrays are supported only as function-local stack buffers). The `no-typed-array-field` lint rule is added to the boilerplate eslint template (`eslint-rules-template.ts` + `init-templates.ts`) and emitted `eslint-transpiler-rules.mjs` so it persists into new `cuttlefish create` projects. A/A.2 re-confirm the existing by-design `no-typed-array-return` / `no-array-param-content-mutation` gates; B re-verified as already-correct. | `tests/semantic-gates.test.ts` (`TS2CPP_TYPED_ARRAY_FIELD`) |
| #22 | A (array mutators `.pop`/`.push`/`.shift`/`.unshift`/`.sort`/`.fill`/`.concat`/`.splice`/`.map`/`.filter`/... on an **instance-field receiver** `this.field.method()` now lower correctly — the native strategy's receiver regex used `(\w+)` which stopped at the `>` in `this->ops`, capturing only `ops` and emitting `this->__tc_pop(ops)`; replaced with a shared `RECV` pattern `[\w$]+(?:->\w+\|\.\w+)*` matching the full member-access chain), B (a free function whose only call site is inside a **parenthesized sub-expression** in a class method no longer gets tree-shaken — the `paren` IR node had no case in `collectExpressionIdentifiers`, so the call-graph/reachability pass never saw the callee and removed the function; added `paren` plus `lambda`/`tuple-access`/`hal-expr` cases), C (non-nullish **same-kind unions** — narrowed enum-member unions `K.B\|K.C` and string-literal unions `"+"\|"-"` — now coalesce to their single primitive category in `canonicalize()` instead of tripping a false-positive `TS2CPP_UNCLASSIFIABLE_TYPE`; heterogeneous unions `number\|Point` still classify as `unknown`), F (`.length` on a **Map/Set instance field** now lowers to `.size()` — `resolveLengthProperty`'s member-receiver path only recognized `std::string`/`std::vector`/`StaticArray` field types and fell through to the C-string `strlen()` default for `std::map`/`std::set`, emitting `strlen(this->m)` on a struct; now every STL container field routes to `.size()`, with `strlen` kept only for explicit `const char*`/`char*` fields). No new lint rule (all four are compile-time transpiler fixes; no new by-design gate is needed). | `tests/packages/transpiler/demo-22-regressions.test.ts` (A/B/C/F) |
| #23 | B (a class **value-field** access `this->field.X` inside a class method was wrongly arrowed to `this->field->X` whenever a same-named **pointer variable** existed elsewhere in the program — a name collision: the `globalPointerVarTypes` loop in `fixPointerFieldAccess` (`emit/emitters/top-level-prep.ts`, threaded as `calleeTransformer` through `statement-renderer.ts` `renderCall`) used an unguarded `\b${var}\.` regex whose `\b` word boundary also matches between `->` and the name in a member-access chain, so `this->heap` was rewritten to `this->heap->`; now uses the same `(^|[^>.])${var}\.` guard as the adjacent `pointerStructFields` loop, leaving `this->heap.x`/`obj->heap.x`/`a.heap.x` alone and rewriting only standalone `heap.x`). No new lint rule (compile-time transpiler fix). | `tests/packages/transpiler/demo-23-regressions.test.ts` (B) |
| #25 | A (the `TS2CPP_MAP_VALUE_COPY_MUTATION` semantic gate was a **false positive** for *class-typed* map values — a TS `class` is a reference type that lowers to a C++ pointer, so `const e: Entry = map.get(k)` lowers to `Entry* e = map.at(k)` and `e.field = v` lowers to `e->field = v`, persisting through the pointer; the gate now resolves the value type via the TypeChecker and exempts class instances via a new `isClassInstanceType` helper in `orchestrator/semantic-facts.ts`, applied at both the declaration-origin and reassignment-origin recording sites). B (a user class named `Node` collided with the DOM `lib`'s global `Node` type — the scaffolded `tsconfig.json` template no longer ships `"dom"` in `lib`, and the `console` global is now declared in the regenerated `cuttlefish-env.d.ts` (`config-loader.ts`) and the `create` template (`init-templates.ts`), so `console.log` types without pulling in DOM globals; a new `TS2CPP_GLOBAL_NAME_COLLISION` semantic gate in `orchestrator/type-checker.ts` pre-scans the program's non-user files for global names and flags any colliding user class/interface/enum/type-alias declaration with one clear, source-located diagnostic — defense-in-depth for projects that add `"dom"` back). | `tests/semantic-gates.test.ts` (`TS2CPP_MAP_VALUE_COPY_MUTATION` class exemption × 5; `TS2CPP_GLOBAL_NAME_COLLISION` × 5); `tests/packages/transpiler/init-scaffold.test.ts` (no-dom + console-ambient × 2) |
| #26 | A (the scaffolded `tsconfig.json` shipped `noUncheckedIndexedAccess: true`, which forced an unverified `arr[i]!` non-null assertion on every array-index read — the emitted storage is always-dense `std::vector` built by `push_back`/literals (sparse arrays, the flag's primary catch, don't occur), idiomatic indices are bounded by `.length` by construction (the flag cannot distinguish an in-bounds access from a genuinely OOB one), and the `!` escape hatch is unchecked so the "safety" is fully re-routed into an author's unverified promise — pure friction, 11 forced `!`s in 265 lines on provably-in-bounds accesses; the flag is removed from the `cuttlefish create` template `create/init-templates.ts`, `strict` + `strictNullChecks` retained so genuine null/undefined holes are still caught). No transpiler emission fix needed — the path-halving array-index write `this.parent[cur] = this.parent[this.parent[cur]]` (the novel stress: an array-index WRITE on an instance-field array inside a `while` loop, with index and RHS both computed from further `this.field[...]` reads) lowered correctly on the first attempt and was verified against the generated `main.h`. | `tests/packages/transpiler/init-scaffold.test.ts` (noUncheckedIndexedAccess-absent assertion × 1) |
| #27 | **Four transpiler fixes applied (C/D/E/F), pinned by regression tests; A is TS-level (out of scope), B reclassified as correct C++.** C (`.length` on a **function-local `std::vector`** lowered to the invalid `vector.length()` instead of `.size()` — the `mutableArrayVars` and `activeArrayLiteralVars` branches of `resolveLengthProperty` (`ir/expression-to-ir.ts`) emitted `.length()`; both now emit `static_cast<long long>(x.size())`. The top-level-const-array path already worked; the `this->field` path was fixed by demo #22 fix F; this closed the bare-local-identifier hole. `std::string` keeps `.length()`). D (string methods — `.toLowerCase`/`.toUpperCase`/`.trim`/`.substring`/`.slice`/`.padStart`/`.padEnd`/`.replace`/`.charAt`/`.charCodeAt`/`.endsWith`/`.startsWith`/`.includes`/`.indexOf`/`.lastIndexOf`/`.repeat`/`.split`/`.join` — on a **non-bare-identifier receiver** (`X[i]`, `obj->field`, `obj.field`) were left verbatim; the post-emit text rewrite `applyStringMethodRewrites` (`api/shared/string-method-registry.ts`) had a `RECEIVER_PATTERN` that only matched bare identifiers and `.member` chains. Migrated string-method lowering into the **structural IR-build path** `tryLowerArrayAndStringMethods` (`ir/transformers/array-methods.ts`) — the same path demo #22 migrated array mutators to — so the receiver is rendered via `expressionToIR` (handles bare id / `this.field` / `obj.field` / `X[i]` / chains uniformly). Arity-aware helper lookup (`substring(0,2)` → `__tc_substring2`, `substring(2)` → `__tc_substring1`); ambiguous string/array methods (`indexOf`/`includes`/`startsWith`/`endsWith`/`slice`/`substring`) gate on the receiver's resolved C++ type, with element-access type resolution (`words[i]` derives the container's element type). The native `startsWith` → `rfind` special case is preserved. Arduino keeps the legacy text rewrite (structural path gated on `isHostedTarget`); the `applyStringMethodRewrites` call was removed from `framework-native/src/strategy.ts`). E (the `__tc_toLowerCase` helper was emitted but never declared — fixed **transitively** by D: the structural lowering emits `__tc_toLowerCase(...)` into a `raw` IR node that `program-analysis.ts`'s `expr.value.includes(name)` scan already visits, so the helper is registered whenever used). F (`TS2CPP_GLOBAL_NAME_COLLISION` treated `@types/node` declarations as globals even with `tsconfig "types": []` — the `globalNames`-builder loop in `runSemanticGates` (`orchestrator/type-checker.ts`) walked every non-user program file; now excludes `/node_modules/@types/` and `/packages/`, matching the adjacent `interfaceNames` filter. TS's own `lib.*.d.ts` files live under `node_modules/typescript/lib/` and are NOT excluded, so DOM globals like `Node`/`Element` are still caught). A (standard TS `Map.has`+`.get` narrowing — `.get()` typed `V \| undefined` even after `.has()`; out of scope, `.get(k)!` workaround). B (indexing a `string` yields C++ `char` — correct C++, not a transpiler gap; the `string[]` idiomatic shape needs no fix). | `tests/packages/transpiler/demo-27-regressions.test.ts` (C/D/E, 10 tests); `tests/semantic-gates.test.ts` (F, 2 new cases via `runGatesWithAmbientTypes`); `tests/semantic-cpp.test.ts` (StaticArray `.length()`→`.size()` assertion updated) |
| #28 | **Five transpiler fixes applied (A/B/C/D/E), pinned by `tests/packages/transpiler/demo-28-regressions.test.ts` (8 tests). Demo source is in its natural idiomatic form (no workarounds) and recompiles clean.** A (`String.*` and `Number.*` static methods were neither lowered NOR lint/build-gated — `String.fromCharCode(c)` silently emitted verbatim and failed at g++ time ("'String' was not declared in this scope"). Added both a `no-restricted-syntax` lint gate (`CallExpression > MemberExpression.callee[object.name='String']` / `[object.name='Number']`) AND a build-time `TS2CPP_NO_EQUIVALENT` rejection in `checkContextSensitive` (`ir/feature-registry.ts`), mirroring the existing `JSON.*`/`Object.*` precedent. The lint gate persists into new projects via the `LINT_RULES`→scaffold pipeline). B (a **promoted top-level variable's** file-scope default initializer was `= 0` for every non-pointer type — invalid for class types (`std::vector<std::string> PRINTABLE = 0;`). A variable is promoted when it is classified runtime AND referenced by a free function, so it must live at file scope; its forward-declaration default is now `{}` (value-initialization, valid for every C++ type: scalars zero, classes default-construct, pointers null). `emit/emitters/function-emitter-impl.ts`). C (a free function called **only as a nested argument** (`out.push(glyphFor(op))`) was tree-shaken. The `call` statement's callee is a lowered raw wrapper (`__RAW_STMT__out.push_back(glyphFor(op))`) and `collectStatementIdentifiers`' `case "call"` only added `calleeParts[0]`, so the inner callee `glyphFor` was invisible to the call graph. Now adds every callee part. Same family as demo #22 fix B (which added the `paren` arm); this is the call-statement arm. **Notably this gap did NOT reproduce under the test harness `transpile()` helper (which skips `filterProgramIR`); the regression test runs the full pipeline.** `ir/identifier-collector.ts`). D (a `switch` with **braced case bodies** (`case X: { ...; break; }`) lowered to an `if/else if` chain but kept each case's `break;`. The lowered form has no switch, so a surviving `break` broke the enclosing loop (silent wrong control flow) or was a hard g++ error outside a loop. The break-stripping pass (`emit/emitters/line-appender.ts`) only filtered top-level breaks (`body.filter(s => s.kind !== "break")`); a braced case body's break is nested inside a `block` statement. Now recurses into a case body's wrapping block(s). Flat case bodies still strip correctly). E (an **enum-typed array index** (`GLYPHS[op]` where `op: Op`) was not cast to integral — a C++ `enum class` does not implicitly convert to `size_t`, so `vector[enumValue]` failed to compile. Element-access rendering (`emit/expression-renderer.ts renderElementAccess`) now routes the index through `renderEnumSafeValue`, which wraps numeric-enum operands in `static_cast<int>(...)` — the same path §1.10 enum relational comparisons use). **Follow-up review of the same fix classes found and closed two sibling gaps, pinned by 7 additional tests in the same file:** (A-review) `Array.from`/`Array.of`/`new Date()` were the same ungated-stdlib class — they emitted verbatim and failed at g++ time; now lint+build-gated (`Array.isArray` IS supported, a compile-time check, so it is intentionally exempt). (E-review) a **bare enum-typed Map key** on `.set`/`.has`/`.get`/`.delete` was not cast (the existing enum-key cast only covered enum MEMBER access `Color.Red`, and only the `.set` statement form); now resolves a bare enum-typed key identifier through the IR type scope and casts in both statement (`call-statement.ts`) and expression (`expression-to-ir.ts`) form. A generic enum value passed as a **call argument to a non-enum parameter** (`add(k)` where `add` takes int) is a known remaining limitation (needs interprocedural parameter-type resolution), documented in SUPPORT_MATRIX §1.7. | `tests/packages/transpiler/demo-28-regressions.test.ts` (A/B/C/D/E + A-review/E-review, 15 tests) |
| #33 | **FIRST Arduino AVR demo (arduino:avr:uno / avr-gcc) — five transpiler fixes + one new architecture-aware diagnostic, pinned by `tests/packages/transpiler/demo-33-regressions.test.ts` (18 tests; pins since removed). Every prior demo (#1–#32) compiled against native `g++`; AVR has no `<vector>`/`<string>`/`<iostream>`, no exceptions/RTTI, and discourages heap. `npm run compile` against `arduino:avr:uno` succeeds (Flash 14%, RAM 15%).** A (a user `function main()` collided with C++'s required `int main()` — Arduino has no `main()` (entrypoints are the auto-generated `setup()`/`loop()`), but the transpiler emitted the user fn as `static void main()` and the top-level `main()` call flowed into `setup()` verbatim → avr-g++ "cannot declare '::main' to be static". The Arduino strategy's `mapFunctionName('main') → 'cuttlefish_main'` existed but was dead code. Fix: route every function name through `strategy.mapFunctionName` when building `mappedFunctions` (`emit/emitters/setup.ts`) and apply the rename at the single call-rendering chokepoint `StatementRenderer.renderCall` (`emit/statement-renderer.ts`), so definition, forward decl, AND every call site — including the top-level `main()` call spliced into `setup()` — follow. No-op on native.). B (`.length` on a **raw C array** emitted `.size()`. A non-mutated local OR top-level const array literal on a no-`std::vector` target (`!strategy.needsStdVector()`, e.g. AVR) lowers to a raw C array `T name[] = {...}` — the same discriminator the emit side (`class-emitter.ts` `addCArrayIfNotMutable`) uses. But `.length` resolution tested only the varType prefix (`std::vector<...>`), so it emitted `name.size()` → avr-g++ "request for member 'size' in 'name', which is of non-class type". Fix mirrors the emit discriminator in `resolveLengthProperty` for BOTH function-locals (`activeArrayLiteralVars` branch) and top-level consts (the identifier fallthrough now reads `globals`, which survives `resetFunctionScopeState` unlike the function-scoped `activeArrayLiteralVars`). Native/generic keep `.size()` — a const array there really IS a `std::vector`. `ir/expression-to-ir.ts` + `ir/transformers/variables.ts`.). C (the `__tc_str_ptr` shim was dropped when a string-typed RETURN/FIELD/LOCAL used it — the `usesStrPtr` analysis compared the PRE-normalization cppType (`std::string`) against `parseCppType(...).kind === "strPtr"`, which never matched because the Arduino strategy normalizes `std::string → __tc_str_ptr` only at emit time → avr-g++ "'__tc_str_ptr' does not name a type". Fix: the `declaredTypes` post-process loop resolves `std::string` through `strategy.normalizeCppType` and sets `usesStrPtr` when it maps to `__tc_str_ptr`. `ir/program-analysis.ts`.). D (reserved-member-name rename was inconsistent across emit sites — a field named like an Arduino macro `min`/`max` was declared `min_` but the `assign` target path used `escapeCppKeyword` on the compound string `this.min` (didn't match bare `min`), leaving `this->min = ...` while reads were `this->min_`; interface/struct field decls used the bare name. Fix: a shared `escapeTrailingMember` helper (`utils/strings.ts`) renames only the trailing member of a compound lvalue, used by the assign-target path; interface field decls route through `escapeCppKeyword(field.name, reservedNames)`. `emit/statement-renderer.ts` + `emit/emitters/type-decl-emitter.ts`.). E (a new architecture-aware diagnostic `TS2CPP_NO_VECTOR_STORAGE` (`framework-arduino/src/strategy.ts` `profileDiagnostics`) rejects a class FIELD / function PARAMETER / RETURN TYPE annotated `T[]` on no-`std::vector` architectures — these resolve to `std::vector<T>` which AVR does not have, and a dynamically-grown storage class can't recover a compile-time size for `__tc_StaticArray<T,N>`. A function-local array initialized from a literal is exempt (it lowers to a fixed-size buffer). This is the pre-compile, target-aware notification the task asked for — more accurate than a target-agnostic eslint rule. Also fixed a latent `profileDiagnostics` cache-mutation bug that would have leaked diagnostics across transpilations in watch mode.). | (pins for A/B/C/D/E removed) |



### Highest-value untested areas (candidates for future demos)

1. **Async/concurrency (§2.6)** — entirely untested; `async`/`await` lower with warnings but no demo exercises the path.
2. **HAL/hardware (§5.5)** — no native/Arduino demo has exercised Pin/bus/SPI lowering end-to-end.
3. **Functional array methods beyond filter (§5.3)** — `map`, `reduce`, `find`, `some`, `every`, `forEach` inline expansion untested.
4. **`Object.*` container ops (§5.4)** — `Object.keys/values/entries` on maps untested.
5. **Ownership wrappers (§4.6)** — `Owned<T>`/`Shared<T>`/`Mutable<T>` untested.
6. **Advanced generics (§1.11)** — generic class, multiple type params untested.
7. **Optional chaining (§1.8)** — `a?.b`, `a?.()` untested.
8. **`for...in` over object keys (§2.2)** — untested (distinct from `for...of`).
9. **String `switch` (§2.4)** — untested.
10. **Decorators & namespaces (§4.7)** — `namespace X {}` untested.
