# Roman numerals ↔ integer + English number-words converter — cuttlefish demo #31

A **mid-complexity, idiomatic TypeScript** program built around three cooperating
utilities that translate between small symbolic representations and the integer
they denote:

1. **`class RomanNumerals`** — encodes an `int32_t` (1..3999) to its Roman-numeral
   string and back. The encoder walks a **descending parallel-array value/symbol
   table** (`ROMAN_VALUES: int32_t[]` + `ROMAN_SYMBOLS: string[]`, indexed in
   lockstep — the classic C "struct-of-arrays" pattern that avoids any
   `Map`/struct allocation in the hot loop) subtracting each value as many times
   as it fits. The decoder walks the input string left-to-right with an `i`
   index, peeking 2 chars at a time for the subtractive pairs (`CM`, `CD`, `XC`,
   `XL`, `IX`, `IV`). Both methods are **`static`** — the class is a pure
   namespace of conversions.
2. **`class NumberWords`** — converts an `int32_t` (1..9999) to its English
   spoken form (`"two thousand three hundred forty-five"`). It composes a small
   lookup of `ONES_TEENS`, `TENS_PLACE` word tables (each a `string[]`) plus a
   `THOUSANDS`/`HUNDREDS` suffix and joins the parts with
   `parts.push(...) → parts.join(' ')`.
3. The driver — round-trips a handful of culturally-salient numbers through
   Roman ↔ int, spells each in English, and decodes a few sample Roman inputs
   (including a bogus one to exercise the reject path).

This is the **thirty-first** demo iteration. Like #15–#30 it is deliberately
**readable** — real, everyday TypeScript — and is **not** a feature-exhaustion
test. It deliberately picks a **different data shape** from #15–#30
(`Map`-over-struct, container-valued map, byte sieve, token stream, min-heap,
prefix-trie, doubly-linked list, disjoint-set forest, Vigenère cipher,
Brainfuck interpreter, CRC-32 + INI parser, markdown flattener):

- **parallel `int32_t[]` + `string[]` arrays indexed in lockstep** — the
  struct-of-arrays pattern. No prior demo used this shape; all of them leaned
  on a `Map` or a `struct[]`.
- **a `static` factory and `static` lookup-table fields** on a class, reached
  only through `Cls.method(...)`.
- **a `for (const r of TOP_LEVEL_STRING_ARR)`** whose element type must flow
  into a template-literal format specifier.
- **a `.join(' ')` on a `.push`-built `string[]`**.

Transpiled to C++ by cuttlefish (`@typecad/framework-native`).

The previous iteration (#30, markdown flattener + word-frequency analyzer) is
preserved in `demo30-backup/`.

## Running

```bash
npm run lint      # ESLint with the cuttlefish transpiler-rules plugin
npm run compile   # transpile TS -> C++ and compile with g++
# binary lands in demo/src/out/.build/main.exe
```

- **`npm run lint` exits 0** with no warnings.
- **`npm run compile` exits 0** with one info diagnostic (`ownership-suggest-const`,
  a hint). `g++` emits no errors and no warnings.
- When `g++` *does* emit errors they are surfaced verbatim and mapped back to
  TypeScript source spans — that is exactly how the three findings below were
  discovered on the first compile attempt.
- The binary runs with correct output.

## Sample output

```
--- Roman numerals + English number words demo ---
[enc] begin
1 -> I -> 1 ok=true | one
4 -> IV -> 4 ok=true | four
9 -> IX -> 9 ok=true | nine
40 -> XL -> 40 ok=true | forty
49 -> XLIX -> 49 ok=true | forty-nine
90 -> XC -> 90 ok=true | ninety
99 -> XCIX -> 99 ok=true | ninety-nine
400 -> CD -> 400 ok=true | four hundred
444 -> CDXLIV -> 444 ok=true | four hundred forty-four
900 -> CM -> 900 ok=true | nine hundred
999 -> CMXCIX -> 999 ok=true | nine hundred ninety-nine
2024 -> MMXXIV -> 2024 ok=true | two thousand twenty-four
3999 -> MMMCMXCIX -> 3999 ok=true | three thousand nine hundred ninety-nine
[enc] end
[dec] begin
MCB -> not Roman
IIX -> 10
XLVII -> 47
[dec] end
[spell] begin
1 = one
19 = nineteen
20 = twenty
21 = twenty-one
100 = one hundred
101 = one hundred one
1000 = one thousand
9999 = nine thousand nine hundred ninety-nine
[spell] end
done
```

Verified by hand:

- Every Roman round-trip matches (`ok=true`). The greedy encoder produces the
  canonical subtractive forms (`IV`, `IX`, `XL`, `XC`, `CD`, `CM`).
- `MCB` → not Roman (`B` is not a Roman glyph; decode rejects via the
  `ROMAN_CHARS.has(ch)` membership check).
- `IIX` → 10 (not strictly canonical, but every char IS Roman so the decoder
  accepts it: reads `I`+`I` then `X`, and `1+1+(10-2)=10` by the left-to-right
  `next < cur ⇒ subtract` rule; the demo deliberately includes it to exercise
  the permissive path).
- `XLVII` → 47 (`(50-10)+5+1+1`).

## What the source exercises

Idiomatic patterns that lower cleanly:

- §1.2  fixed-width `int32_t`, `double`, `boolean` → `bool`
- §1.4  template literals interpolating `number`/`string`/`boolean` values,
  including a `${r}` where `r` is a `for...of` element of a top-level
  `const string[]` (the loop variable must carry its real `std::string` type
  so the snprintf specifier resolves to `%s`, not the default `%d`).
- §2.2  C-style `for (let i; i < N; i = i + 1)`, read-only `for...of` over a
  `string[]`, `while` loop with a peek-2-char condition.
- §3.1  module-scope free functions (`peekPair`, `indexOfSymbol`) called from
  a class method, including one called inside a `while` condition.
- §4.1  two `class`es with **`static` methods** and **no instance state**.
- §4.3  `Cls.method(...)` static-call lowering.
- §5.3  `.charAt`, `.length`, indexed `arr[i]` reads, and `.join(' ')` /
  `.join('')` on a `.push`-built `string[]`.
- §6.1  **module-scope `const` arrays** (`ROMAN_VALUES`, `ROMAN_SYMBOLS`,
  `ROMAN_CHARS`, `ONES_TEENS`, `TENS_PLACE`, `SAMPLE_NUMBERS`, `SAMPLE_ROMAN`)
  emitted at file scope with matching `extern` declarations in the header (so
  the inline class-method bodies that read them see them).

---

# Transpilation issues found by Demo #31

Demo #31 was written around a `static` class method that reads **indexed
top-level const arrays** through a `parts.push(globalArr[i])` call. The
**first** compile attempt failed with three distinct `g++` errors. They are
reproduced verbatim below (as the CLI surfaced them, mapped to TS spans). All
three were traced to root cause, **fixed in the transpiler** (not worked around
in source), and the demo now compiles and runs cleanly in its natural idiomatic
form.

## Finding A — top-level `const` reached only via a `__RAW_STMT__` callee containing an array index was tree-shaken (NEW)

`parts.push(ONES_TEENS[thousands])` is the natural idiomatic TS for "append the
thousands-place word to the phrase under construction". The transpiler lowers
`.push(arg)` on a `std::vector` to a fully-formed C++ raw statement:

```cpp
__RAW_STMT__parts.push_back(ONES_TEENS[thousands])
```

with `args: []` — the argument expression `ONES_TEENS[thousands]` is **baked
into the callee text**, not preserved as a structured IR arg. The identifier
collector (`collectStatementIdentifiers`'s `call` case) then tried to recover
the embedded identifiers by splitting the callee on `/->|::|[.(]/`. That split
breaks at `[`, `(`, and `.`, but **not at `]` or `)`** — so the token
`"ONES_TEENS[thousands])"` survived as ONE compound string and the identifier
`ONES_TEENS` was never added to the call graph as a dependency of the
`NumberWords` class. `filterProgramIR` then tree-shook `ONES_TEENS` (and
`TENS_PLACE`, reached the same way) — they were emitted in NEITHER the `.cpp`
definition NOR the `.h` extern — and `g++` rejected the inline class-method
body:

```
src\main.ts (230,5) error [if]: 'ONES_TEENS' was not declared in this scope
        if (below100 >= 20) {
        ^
src\main.ts (236,9) error [call]: 'ONES_TEENS' was not declared in this scope
            parts.push(TENS_PLACE[tens] + '-' + ONES_TEENS[ones]);
            ^
src\main.ts (242,12) error [if]: 'TENS_PLACE' was not declared in this scope
        } else if (below100 > 0) {
               ^
```

This is the **same blind-spot family** as demo #22 B (paren wrapper),
demo #28 C (call statement with nested callee), and demo #30 A (raw wrapper
from a class-method visibility walk) — each found a different IR walk that
under-extracted identifiers from a lowered raw/paren wrapper. The convergence
point is the canonical `collectStatementIdentifiers`; this finding adds the
`__RAW_STMT__`-callee arm to it.

**Fix:** when a `call` statement's callee is a `__RAW_STMT__` wrapper, scan its
raw text with the SAME identifier regex the `raw` expression case already uses
(`/[A-Za-z_][A-Za-z0-9_]*/g`), so every identifier embedded in the raw
expression is collected regardless of bracket/paren structure.
`packages/cuttlefish/src/ir/identifier-collector.ts`.

## Finding B — `.join(sep)` on a `std::vector` was emitted verbatim (NEW)

`parts.join(' ')` is the natural idiomatic TS for "concatenate the phrase
pieces with single spaces". The transpiler emitted it **verbatim**:

```cpp
return parts.join(" ");
```

— and `g++` rejected it:

```
src\main.ts (246,5) error [return]: 'class std::vector<std::__cxx11::basic_string<char> >' has no member named 'join'
        return parts.join(' ');
```

**Root cause:** `__tc_join` was misclassified in the **STRING**-method registry
(`api/shared/string-method-registry.ts` `STRING_METHODS`), even though `.join`
operates on a `std::vector`, not a `std::string`. The string-method lowering
path was therefore the only path that recognized the name. But
`shouldLowerAsStringMethod` **correctly** rejects known-array receivers — a
`.push`-built `string[]` is in `mutableArrayVars`, and an array is never a
string-method receiver. And the vector-method table
(`VECTOR_VALUE_METHOD_LOWERINGS`) had **no `join` entry**. So BOTH paths
declined the call, and it fell through to verbatim emit.

A NAMED, NON-MUTATED `const ARR: string[] = [...]; ARR.join('-')` happened to
work, because such a receiver is NOT in `mutableArrayVars`, so the (incorrect)
string-method path fired and emitted `__tc_join` by accident. The bug only
surfaced on the idiomatic `.push`-then-`.join` shape.

**Fix:** removed `__tc_join` from `STRING_METHODS` and added a `join` entry to
`VECTOR_VALUE_METHOD_LOWERINGS` in `ir/transformers/array-methods.ts`. The
polyfill helper is still registered via `POLYFILL_HELPER_MAP['.join(']`
(`api/shared/polyfill-helper-registry.ts`), so the `__tc_join` template is
emitted when needed.

## Finding C — `for (const r of GLOBAL_STRING_ARR)` interpolated into a template picked `%d` instead of `%s` (NEW)

```ts
const SAMPLE_ROMAN: string[] = ['MCB', 'IIX', 'XLVII'];
for (const r of SAMPLE_ROMAN) {
  console.log(`${r} -> not Roman`);   // r is std::string
}
```

The emitted C++:

```cpp
for (const auto& r : SAMPLE_ROMAN)              // ← r is `auto`, not std::string
{
  char __cuttlefish_str_4[26];
  snprintf(__cuttlefish_str_4, sizeof(__cuttlefish_str_4), "%d -> not Roman", r);   // ← %d, not %s
  std::cout << __cuttlefish_str_4 << std::endl;
}
```

— and `g++ -Wformat=` flagged it:

```
src\main.ts (292,7) warning [call]: format '%d' expects argument of type 'int', but argument 4 has type 'const std::__cxx11::basic_string<char>' [-Wformat=]
          console.log(`${r} -> not Roman`);
          ^
```

(And at runtime the `%d` would read the `std::string`'s first bytes as an int —
garbage.)

**Root cause:** `inferExprCppType` (`ir/type-resolution.ts`) for a bare
`ts.Identifier` consulted ONLY the function-local types map
(`localVariableTypes`). It did not consult the IR type scope's `globals` map
(populated for every top-level decl in `transformers/variables.ts`). So a
top-level `const ARR: string[]` resolved to `"auto"` when used as a `for...of`
iterable; the element-type inference then saw `auto` (not a vector); the loop
variable kept `auto`; and because a `for...of` variable has **no initializer**
(the value comes from the C++ range-for), the snprintf specifier picker's
`auto`-recovery branch (which re-infers from `knownVar.initializer`) had
nothing to recover from — it defaulted to `%d`.

A `for (const n of SAMPLE_NUMBERS)` over an `int32_t[]` worked **only by
accident**: the `auto` defaulted to `%d`, which happens to be correct for an
integer.

**Fix:** `inferExprCppType` now consults `getCurrentIrTypeScope().globals` as a
fallback for bare identifiers, matching what `resolveReceiverCppType` (in
`ir/transformers/array-methods.ts`) already does for the string/array-method
disambiguation. `packages/cuttlefish/src/ir/type-resolution.ts`.

---

## Sibling scan

- **Finding A's** root cause (an under-tokenizing raw-text split that left
  `name[...]` glued together) is a no-sibling recurrence of the
  raw-wrapper blind-spot family (demos #22 B / #28 C / #30 A). Each IR walk
  has its own raw-text handling, so each was patched individually; the
  convergence point is the canonical `collectStatementIdentifiers`, which is
  now used by `setup.ts` (demo #30 A) and patched for `__RAW_STMT__` callees
  here. No other walk in the tree splits raw text on an incomplete separator
  set — the `raw` expression case already uses the identifier regex, and
  `method-call` callees are helper names (`__tc_pop`) with structured args.
- **Finding B's** root cause (a method misclassified into the wrong lowering
  table) was scanned across `STRING_METHODS`: no other entry is a vector
  method in disguise (every other listed helper genuinely operates on a
  `std::string` receiver — `__tc_toUpperCase`, `__tc_charAt`, etc.). `.join`
  was the lone misclassification.
- **Finding C's** root cause (an identifier-type lookup that ignored
  module-scope globals) was scanned for siblings: `resolveReceiverCppType` in
  `array-methods.ts` already consults globals; the member-access branch of
  `inferExprCppType` already consults globals (line ~747); the bare-identifier
  branch was the lone holdout.

All three fixes are pinned by `tests/packages/transpiler/demo-31-regressions.test.ts`
(14 tests). The demo source carries no workarounds — it is in its natural
idiomatic form.
