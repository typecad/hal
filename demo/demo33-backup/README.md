# Sensor statistics over a fixed sample window — cuttlefish demo #33 (Arduino AVR)

A **mid-complexity, idiomatic TypeScript** program modelling the bread-and-butter
embedded pattern: take a batch of samples, compute running statistics, and report.
It is the **first demo to target the Arduino AVR toolchain** (`arduino:avr:uno`,
compiled with `avr-gcc` via `arduino-cli`). Every prior demo (#1–#32) compiled
against the native `g++` toolchain.

The program runs once in the auto-generated `setup()` (the top-level `main()` call
flows into it) and the auto-generated `loop()` stays empty — the natural shape of a
"compute and report" sketch with no periodic work.

Transpiled to C++ by cuttlefish (`@typecad/framework-arduino`), compiled for
`arduino:avr:uno`.

The previous iteration (#32, Conway's Game of Life on a `uint8_t[][]` grid) is
preserved in `demo32-backup/`.

## Running

```bash
npm run lint      # ESLint with the cuttlefish transpiler-rules plugin
npm run compile   # transpile TS -> C++ (.ino) and compile with avr-gcc
```

- **`npm run lint` exits 0** with no warnings.
- **`npm run compile` exits 0**. `avr-gcc` emits **no errors and no warnings**.
  Memory usage on an ATmega328P (Arduino Uno):

  ```
  Flash: 4.4 KB / 31.5 KB (14%)
  RAM:   314 B / 2.0 KB (15%)
  Heap:  1.7 KB available
  ```
- When `avr-gcc` *does* emit errors they are surfaced verbatim and mapped back to
  TypeScript source spans — that is exactly how the five findings below were
  discovered on the first compile attempt.

The program prints (open the serial monitor at 9600 baud after upload, or read the
computed values from the source):

```
--- sensor statistics demo ---
count: 12
min:    0
max:    1023
sum:    1077
avg:    89
done
```

The sample window is `SAMPLES = [0,1,2,0,4,5,6,7,8,1023,10,11]` — a rising ramp
with a floor outlier (index 3) and a ceiling outlier (index 9), so the min/max/avg
are non-trivial. Integer division gives `avg = 1077 / 12 = 89`.

## Why AVR shaped the program

AVR (ATmega328P, 2KB RAM) imposes real constraints that shape the data layout:

- **The sample window is a fixed literal array** (`const SAMPLES = [...]`). On AVR a
  non-mutated local/top-level array literal lowers to a fixed-size C array
  `int32_t[N]` — the only array storage the target supports. A dynamically-grown
  array (`.push` in a loop, or a class field/param/return typed `T[]`) would need
  `std::vector`, which AVR does not have; the transpiler now rejects those at build
  time (`TS2CPP_NO_VECTOR_STORAGE`).
- **Owned mutable state lives in a class with scalar fields only**
  (`Accumulator`: sum/count/min/max). This lowers to a POD-ish C++ struct.
- **The report is built by string concatenation** (not `.push`+`.join` on a growable
  `string[]`), so no growable array storage is needed.

## What the source exercises

Idiomatic patterns that lower cleanly to AVR:

- §1.2  fixed-width `int32_t`, `boolean` → `bool`
- §1.5  **fixed-literal `int32_t[]` top-level array** → raw C array `int32_t[N]`,
  with `.length` → `sizeof(SAMPLES)/sizeof(SAMPLES[0])` (Finding B made this work)
- §1.6  `interface Stats { ... }` → POD `struct` returned by value
- §1.7  `const enum Phase` + numeric `switch` driving the synth driver
- §2.2  C-style `for (let i; i < count; i = i + 1)`
- §4.1  `class Accumulator` with scalar instance fields, ctor, methods
- §5.3  string concatenation building a multi-line report
- §6.1  `function main()` + top-level `main()` call → `cuttlefish_main` called from
  the auto-generated `setup()` (Finding A made this work)

---

# Transpilation issues found by Demo #33

Demo #33 was the first compile against `arduino:avr:uno` (avr-gcc). The first
attempt failed with five distinct error families, all reproduced verbatim from
`npm run compile` (mapped to TS spans). All five were traced to root cause,
**fixed in the transpiler / framework-arduino** (never worked around in source),
and the demo now compiles and would run cleanly on hardware in its natural
idiomatic form. A sixth architectural decision (E) added a new diagnostic.

## Finding A — a user `function main()` collided with C++'s required `int main()` (NEW)

```
src\main.ts (96,18) error [function_declaration]: cannot declare '::main' to be static
static void main();
                 ^
src\main.ts (96,18) error [function_declaration]: '::main' must return 'int'
```

Arduino has **no `main()`** — the entrypoints are the auto-generated `setup()` and
`loop()`. A user `function main()` is NOT the entrypoint (the entrypoint is
`setup`), so it was emitted as `static void main()` — which collides with C++'s
hard requirement that `::main` returns `int`. The top-level `main()` call flowed
into the auto-generated `setup()` body correctly, but the *definition* collided.

**Root cause (generalizable):** the Arduino strategy's
`mapFunctionName('main') → 'cuttlefish_main'` rename existed but was **dead code**
— `mapFunctionName` was only consulted for async functions and entrypoint
detection, never applied to user function names at emit time. So the rename never
fired.

**Fix (the widest generalization):** every function name now routes through
`strategy.mapFunctionName` when building `mappedFunctions`
(`emit/emitters/setup.ts`), and the rename is applied at the **single
call-rendering chokepoint** `StatementRenderer.renderCall`
(`emit/statement-renderer.ts`) — so the definition, the forward declaration, AND
every call site (including the top-level `main()` call spliced into `setup()`)
all follow the rename uniformly. On native (where `mapFunctionName` is the
identity) this is a no-op.

## Finding B — `.length` on a raw C array emitted `.size()` (NEW)

```
src\main.ts (165,9) error [var_decl]: request for member 'size' in 'SAMPLES',
    which is of non-class type 'int32_t [12] {aka long int [12]}'
    const stats: Stats = computeStats(SAMPLES.length);
          ^
```

A non-mutated array literal on a target that does **not** need `std::vector`
(`!strategy.needsStdVector()`, e.g. Arduino AVR) lowers to a **raw C array**
`int32_t SAMPLES[] = {...}` — the same discriminator the emit side
(`class-emitter.ts` `addCArrayIfNotMutable`) uses to decide raw-C-array vs
`std::vector`. But `.length` resolution tested only the varType *prefix*
(`std::vector<...>`), so it emitted `SAMPLES.size()` — and a raw C array has no
`.size()` member.

**Root cause (generalizable):** the IR-build `.length` resolver and the emit
path disagreed on whether a given array-typed binding lowers to a container
(`std::vector` / `__tc_StaticArray`, which have `.size()`) or a raw C array
(`sizeof(x)/sizeof(x[0])`). Two sub-cases:

- **Function-local** literals (`const a = [1,2,3]`) — the `activeArrayLiteralVars`
  branch now mirrors the emit discriminator (`!needsStdVector()` OR
  promoted-to-`StaticArray` via `mutableArrayVars` → container `.size()`; else
  raw C array → `sizeof`).
- **Top-level** literals (`const SAMPLES: int32_t[] = [...]`) — not in any
  function-scoped set (`resetFunctionScopeState` clears `activeArrayLiteralVars`
  before each function), so `.length` fell through to the default `.size()`. The
  identifier fallthrough now reads `globals` (which persists across function
  scopes) and routes a top-level `std::vector`-typed const array on a
  no-`std::vector` target to `sizeof`.

**Fix:** `ir/expression-to-ir.ts` `resolveLengthProperty` (both branches) +
`ir/transformers/variables.ts` (track top-level vec-typed literals in
`activeArrayLiteralVars`). Native/generic (`needsStdVector()` true) keep
`.size()` — a const array there really IS a `std::vector`.

## Finding C — the `__tc_str_ptr` shim was dropped for string returns/fields (NEW)

```
src\main.ts (156,3) error [function_declaration]: '__tc_str_ptr' does not name a type;
    did you mean '__ptr_t'?
    __tc_str_ptr report() {
    ^~~~~~~~~~~~
```

The Arduino strategy normalizes `std::string → __tc_str_ptr` (a fixed-buffer shim)
at **emit time**. But the `usesStrPtr` analysis flag — which gates emission of the
`__tc_str_ptr` shim block — compared the **pre-normalization** cppType
(`std::string`) against `parseCppType(...).kind === "strPtr"`, which never matched.
So a string-typed RETURN/FIELD/LOCAL silently dropped its own shim and avr-g++
saw `'__tc_str_ptr' does not name a type`.

**Root cause (generalizable):** the analysis pass and the emit pass disagreed on
type spelling because normalization happens in between. The `usesStrPtr`
detection looked at the pre-normalization type; the emit normalized it later.

**Fix (the broadest chokepoint):** the `declaredTypes` post-process loop in
`ir/program-analysis.ts` (which sees every declared type — locals, fields, params,
returns, aliases) now resolves `std::string` through `strategy.normalizeCppType`
and sets `usesStrPtr` when the strategy maps it to `__tc_str_ptr`. On native
(normalizer leaves `std::string` alone) this is a no-op.

## Finding D — reserved-member-name rename was inconsistent across emit sites (NEW)

```
src\main.ts (145,3) error [assign]: 'const struct Stats' has no member named 'min_';
    did you mean 'min'?
    line = line + 'min:    ' + s.min + '\n';
          ^
```

A field named like an Arduino macro (`min`/`max`, which are function-like macros
in `Arduino.h`) is escaped to avoid the collision. But the rename was applied
**inconsistently**:

- the **class field declaration** used `escapeCppKeyword(name, reservedNames)`
  → suffix `_` (`min_`),
- the **interface/struct field declaration** used the bare `field.name` (no
  escape) → `min`,
- the **field access** `s.min` used `escapeFinalMemberName` → `min_`,
- the **assign target** `this.min = ...` used `escapeCppKeyword` on the *whole
  compound string* `this.min` — which doesn't match the bare reserved name `min`,
  so it was left as `this.min`.

So `struct Stats { int32_t min; }` was accessed as `s.min_`, and `this->min_`
(field) was assigned via `this->min = ...` (target) — declaration/access
mismatches everywhere.

**Root cause (generalizable):** two problems. (1) The assign-target path applied
a whole-identifier escape to a *compound* member-access string. (2) Interface
field declarations didn't escape at all. Both diverged from the class-field-decl
+ field-access convention.

**Fix:** a shared `escapeTrailingMember` helper (`utils/strings.ts`) renames only
the **trailing member** of a compound lvalue (`this.field`, `obj->field`,
`obj.field`) — used by the assign-target path (`emit/statement-renderer.ts`).
Interface field declarations now route through
`escapeCppKeyword(field.name, reservedNames)` (`emit/emitters/type-decl-emitter.ts`)
to match class fields and accesses. Now declaration, assignment, and read all
agree on `min_`.

## Finding E — `std::vector` storage on AVR was silently emitted (NEW diagnostic)

```
src\main.ts (112,8) error [...] 'vector' in namespace 'std' does not name a
    template type
    std::vector<int32_t> data;
          ^~~~~~
```

A class FIELD, function PARAMETER, or RETURN TYPE annotated `T[]` resolves to
`std::vector<T>`. AVR has no `<vector>` and discourages heap allocation, so this
has no valid lowering. A function-LOCAL array initialized from a literal is fine
(it lowers to a fixed-size `__tc_StaticArray<T,N>` / raw C array — the literal
supplies N), but a field/param/return has no literal at the declaration site to
recover a compile-time size, and is dynamically grown in the idiomatic case.

**Root cause (generalizable):** AVR's `recommendedArrayImpl: "static_array"` was
**defined but never consulted** anywhere in the transpiler. Every `T[]` annotation
resolved to `std::vector<T>` regardless of target capability.

**Fix (decision + diagnostic):** rather than emit `std::vector<T>` and let avr-g++
fail with an opaque message, the framework-arduino strategy's `profileDiagnostics`
(`framework-arduino/src/strategy.ts`) now emits a clear, source-located
`TS2CPP_NO_VECTOR_STORAGE` error for every such site on no-`std::vector`
architectures. This is the **pre-compile, target-aware notification** for the
pattern — more accurate than a target-agnostic eslint rule (the same code is valid
on native/ESP32). **Workarounds:** keep dynamic collection storage function-local
(initialized from a literal), use a `Map`/`Set` for keyed storage, or model owned
state as a class with scalar fields. (A latent `profileDiagnostics`
cache-mutation bug — the cached profile's `.diagnostics` array was being mutated
across transpilations on a shared strategy instance, leaking diagnostics in watch
mode — was fixed in the same change.)

---

## Why no eslint rule was added

The five fixes are split by what the right notification channel is:

- **A/B/C/D** are transpiler **bugs on fully-supported, idiomatic TypeScript
  patterns** — a `function main()`, a `.length` call, a string return, a `min`
  field are all legitimate. A lint gate would wrongly reject correct code. The
  fixes are purely transpiler-internal.
- **E** is a genuine platform limitation, and it IS notified before compilation —
  via the build-time `TS2CPP_NO_VECTOR_STORAGE` diagnostic, which is
  target-aware (fires only on AVR, not native). A duplicate target-agnostic
  eslint rule would be both redundant and less accurate (it can't know the
  target).

So the transpiler diagnostics are the notification mechanism. This is documented
here so a future maintainer doesn't add a redundant lint rule by mistake.

## What this demo intentionally does NOT cover

To keep the program mid-complexity and AVR-appropriate rather than a
feature-exhaustion test, demo #33 deliberately does **not** exercise:

- `Map`/`Set` (AVR has no `<map>`/`<set>` either — same family as Finding E; a
  future demo could stress keyed storage on a target that supports it),
- `extends` / `super` inheritance (covered by earlier demos),
- `try`/`catch` (AVR disables exceptions; not idiomatic here),
- async/concurrency,
- HAL pin/bus operations (the demo is pure computation — a future AVR demo could
  exercise `digitalWrite`/`analogRead` end-to-end).

Each of those is its own future demo.
