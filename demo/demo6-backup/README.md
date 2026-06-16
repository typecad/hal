# Forge — cuttlefish demo

A deterministic **factory / crafting-logistics simulation** written in idiomatic
TypeScript and transpiled to C++ by cuttlefish (`@typecad/framework-native`).
Four workstations (two `Smelter`s and two `Assembler`s, a polymorphic class
hierarchy) draw from and deposit into a shared `Stockpile` (a `Map` of material
counts with a `Set` of depletion records). Each tick, every station picks a
feasible `Recipe`, pays its inputs, accrues energy, and crafts its output
(smelters double-yield when a catalyst is present). After 64 ticks the run
reports craft counts, success rate, energy consumed, a recipe-id checksum, and
the residual stockpile.

This is the **sixth** demo iteration. Each iteration targets a different
SUPPORT_MATRIX slice. Demo #6 exercises **class inheritance + polymorphism**
(`abstract class` base, two `extends` subclasses, `super()`, `override`d virtual
methods, virtual destructor), **getters/setters**, **static fields/methods**,
**`switch` over an enum/int discriminator**, **`Set<T>`**, **`try/catch`** on a
native target, and **`function`-as-argument** (`std::function`) — a slice not
covered by Demos #3–#5.

## Layout

```
demo/src/
  models/
    Types.ts        const enums (Material, StationKind w/ computed values),
                    interfaces (Recipe, RunStats, Resource, CatalogEntry),
                    scalar tunables, buildCatalog() factory, materialName()
                    (switch over enum)
    Stockpile.ts    class — Map<Material,int16> stock + Set<Material> depleted,
                    deposit/withdraw/amountOf/hasBeenDepleted, static factory,
                    static format(), countDistinct()
    Workstation.ts  abstract class (pure-virtual produces(), virtual craft()),
                    getters/setters, static nextId; Smelter and Assembler
                    subclasses (extends + super() + override); pickRecipe()
    Recipes.ts      buildRecipes() factory, complexity(), sumIds()
    Forge.ts        orchestrator — owns station* vector + Stockpile, runs the
                    do...while tick loop with switch dispatch, try/catch on
                    heavy recipes, summarize()/report(formatter)
  main.ts           sim driver — constructs Forge, calls run(), report(named
                    callback), reads RunStats fields, prints verdict
```

## Running

```bash
npm run compile      # transpile TS -> C++ and compile with g++
# binary lands in demo/src/out/.build/Forge.exe
```

`npm run compile` exits 0 — transpile + g++ + link all succeed. The produced
`Forge.exe` runs with the deterministic output below.

## Sample output

```
forge starting: budget=9
=== FORGE sim complete ===
ticks=64 stations=4
crafts_completed=20 attempted=256 success_rate=7%
energy_consumed=40 materials_consumed=60
checksum=10 per_tick_cap=20
stock=coal=4 ingot=30
depletions=ore
done: completed=20 attempted=256 energy=40 verdict=productive
```

Deterministic and reproducible across runs (verified by running the binary
twice and diffing — byte-identical). The starter stock (40 ore + 24 coal) is
the only input; the run exhausts ore after 20 successful crafts (each smelt
consumes 2 ore) and the remaining ticks fail the input-availability guard,
producing the 7% success rate. All 40 ore and 16 of 24 coal are consumed
(60 materials total); 30 ingots and 4 coal remain in stock.

## SUPPORT_MATRIX patterns exercised

| Area | Pattern | Source |
|---|---|---|
| §1.1 | `let`/`const`, multiple decls | throughout |
| §1.2 | `int16_t`/`uint8_t` pass-through | all files |
| §1.4 | string concat, template literal banner | `Forge.report`, `main.ts` |
| §1.5 | `Map<Material,int16>`, `.get/.set/.has` | `Stockpile` |
| §1.5 | `Set<Material>`, `.add/.has` | `Stockpile.depleted` |
| §1.5 | class-instance array `Workstation[]`, `item->method()` | `Forge.run`, `summarize` |
| §1.5 | `Material[]` element type preserved (indexing yields enum) | `Recipe.inputs` |
| §1.6 | `interface` → `struct` | `Recipe`, `RunStats`, `Resource`, `CatalogEntry` |
| §1.7 | `const enum` (Material, StationKind w/ computed values), enum dispatch | `Types`, switch bodies |
| §2.1 | `if`/`else`, ternary (clamp, verdict) | `Stockpile.deposit`, `main.ts` |
| §2.2 | `for`, `for...of`, `do...while` | tick loop, station iteration |
| §2.4 | `switch` over int discriminator, fallthrough case groups | `Forge.run` |
| §2.5 | `try/catch` on native target | `Forge.run` default arm |
| §3.1 | exported function declarations, factory functions | `buildCatalog`, `buildRecipes` |
| §3.2 | array parameter | `sumIds(ids: int16_t[])` |
| §3.4 | function-as-argument → `std::function<int16_t(int16_t)>` | `Forge.report(addBudget)` |
| §4.1 | class w/ private/public/readonly fields, static field, static factory | `Stockpile`, `Workstation` |
| §4.2 | constructor default param, `this.x` assign, `this.x +=` compound | `Workstation`, `Smelter` |
| §4.3 | getter/setter pair, static method, explicit accessor | `Workstation.energy`, `Stockpile.format` |
| §4.4 | `class B extends A`, `super()` → initializer list, `override` | `Smelter`/`Assembler extends Workstation` |
| §4.4 | abstract method → pure virtual, virtual destructor on base | `Workstation.produces` |
| §4.4 | virtual method override (polymorphism) | `Smelter.craft`, `Assembler.craft` |
| §4.5 | `new C()` returns pointer, `Workstation*` array, deep `->` chain | `Forge.stations` |
| §5.1 | arithmetic, compound `+=`, bitwise `^ << &` | `Recipes.sumIds`, `Stockpile` |
| §5.2 | `Math.floor`, `Math.min` | `Forge.report` |
| §6.1 | top-level → `main()` | `main.ts` |
| §6.2 | multi-file local imports | every file |

---

# Transpilation issues encountered (Demo #6)

Demo #6 surfaced **eight** distinct transpilation issues while targeting a
class-heavy, polymorphic code shape. None are SUPPORT_MATRIX ❌/🚫 patterns —
they are all in patterns the matrix marks ✅ or 🟡.

**Resolution status (post-fix pass):** all eight issues were addressed in a
follow-up pass — **seven fixed in the transpiler** (A, C, D, E-spread, F, G,
H) and **one guarded by a new ESLint rule** (B). Each fix is pinned by a
focused regression test in `tests/packages/transpiler/demo-6-regressions.test.ts`
(10 tests). The full suite is **1019 passed, 0 failed, 19 skipped** (69 files).
The demo source keeps its source-level workarounds where the fix covers the
common case but a deeper cross-file path (object-literal-array shadow structs
for A; the literal-args rest-param call for E; the lambda-param cppType for G)
remains a known limitation noted per-issue below. **`npm run compile` exits 0**
with zero g++ errors and zero g++ warnings.

## A. Cross-file top-level `const` arrays are invisible to other TUs

> **Status: fixed in transpiler** for scalar-element arrays (`emit/emitters/type-decl-emitter.ts` now emits `extern` for array initializers). Pinned by `demo-6-regressions.test.ts > A`. The object-literal-element case (struct-valued arrays that lower to a shadow `_name_t` struct + `std::vector<_name_t>`) still needs the extern to match the shadow type; the demo keeps its factory-function workaround for that case.

**Symptom:** `export const MATERIAL_ORDER: Material[] = [...]` and
`export const RECIPES: Recipe[] = [...]` emit a definition in the `.cpp` but
**no `extern` declaration in the `.h`**. Consumers in other translation units
fail with `'MATERIAL_ORDER' was not declared in this scope` /
`'RECIPES' was not declared in this scope`.

**Scope:** Scalar top-level `const`s (`const TICKS_PER_RUN: int16_t = 64`)
emit correctly as `extern const int16_t` + definition. The gap is specific to
**array-of-struct** (and array-of-enum) top-level consts.

**Workaround (applied):** the material catalog and recipe catalog are built by
factory functions (`buildCatalog()`, `buildRecipes()`) that return a local
vector. A returned/local vector's lifetime is bounded to the caller's scope and
lowers cleanly. The factory call lives wherever the data is needed.

**Suggested fix:** when emitting a top-level `const X[] = [...]`, also emit the
matching `extern const std::vector<T> X;` into the header (as is already done
for scalar consts), or lower top-level const arrays to `static inline` in the
header.

## B. Optional struct field + `!== undefined` lowers to an out-of-scope macro

> **Status: lint-guarded.** New ESLint rule `cuttlefish/no-undefined-compare-on-struct-field` (in `eslint-transpiler-rules.mjs`, registered in `demo/eslint.config.mjs`) flags any `obj.prop === undefined` / `!== undefined` / etc. on a non-computed member access. Pinned by `demo-6-regressions.test.ts > B`.

**Symptom:** `if (recipe.optionalCatalyst !== undefined)` lowered to
`if (static_cast<int>(recipe.optionalCatalyst) != static_cast<int>(CUTTLEFISH_UNDEFINED))`
inside a method body **inlined into the class header**. `CUTTLEFISH_UNDEFINED`
is only `#define`d in the `.cpp` runtime shim (guarded so it's seen once per
TU), so the header compilation fails with `'CUTTLEFISH_UNDEFINED' was not
declared in this scope` / `'the macro had not yet been defined'`.

**Scope:** §1.8 marks `T | undefined` → strips nullish, emits `T`, and `null`/
`undefined` literals → `CUTTLEFISH_UNDEFINED`. The lowering is correct *inside
a .cpp*; the gap is that the macro is unavailable in headers, where class
method bodies are emitted inline.

**Workaround (applied):** `Recipe` uses an explicit `hasCatalyst: boolean`
field instead of an optional `optionalCatalyst?: Material` checked via
`!== undefined`. (The prior demo's `no-undefined-compare-on-get` lint rule
already guards the `.get()` case; this is the struct-field analogue.)

**Suggested fix:** emit the `CUTTLEFISH_UNDEFINED` definition (under its
include guard) into every header that inlines a method body referencing it, or
emit the literal `0` directly at the use site instead of the macro name.

## C. Getter access through a pointer is not rewritten to the getter call

> **Status: fixed in transpiler.** `emit/expression-renderer.ts` renderPropertyAccess now falls back to a type-keyed accessor map (`typeAccessorNames`) when the receiver isn't a registered variable — resolving the loop variable's class type and rewriting `s.energy` → `s->getEnergy()`. Threaded through both the standalone `ExpressionRenderer` and the `StatementRenderer`'s internal renderer. Pinned by `demo-6-regressions.test.ts > C`.

**Symptom:** `for (const s of this.stations) { energy += s.energy; }` emitted
`energy += s->energy;`, but `energy` is a **getter** (`getEnergy()`), not a
field. g++: `'class Workstation' has no member named 'energy'; did you mean
'getEnergy'?`. Getter access on `this` (e.g. `this.stationCount`) lowers
correctly; the gap is getter access through a **pointer-dereferenced loop
variable** (`s->energy`).

**Workaround (applied):** `Workstation` exposes a regular `energyValue()`
method alongside the `energy` getter/setter pair; `Forge.summarize()` calls
`s.energyValue()`. The getter/setter pair is still present to exercise §4.3
and is used on `this` (where it lowers correctly).

**Suggested fix:** in the expression renderer, when a `MemberExpression`'s
property resolves to a known getter and the object is a pointer (the
`->`-access case), emit `->getX()` instead of `->x`. The `this`-receiver case
already does this rewrite; the pointer case needs the same handling.

## D. Object destructuring of a local is hoisted out of scope

> **Status: fixed in transpiler.** `ir/transformers/variables.ts` now builds a structured `property-access` IR node (instead of a `{kind:"raw"}` string) for each destructured property, so `isRuntimeExpression` classifies it as runtime and routes the declaration into the enclosing function body. Pinned by `demo-6-regressions.test.ts > D`.

**Symptom:** inside `main()`, `const { craftsCompleted, craftsAttempted } =
stats` (where `stats` is a local). The destructured decls were emitted as
**file-scope** `const auto craftsCompleted = stats.craftsCompleted;` (because
destructuring is split into individual decls), but `stats` is local to
`main()`. g++: `'stats' was not declared in this scope; did you mean
'static'?`.

**Scope:** §1.9 marks object destructure as ✅. Top-level destructuring
(where the source is also top-level) lowers fine; the gap is destructuring a
**local** inside a function body — the split decls lose their enclosing scope.

**Workaround (applied):** `main.ts` reads `stats.craftsCompleted` etc.
directly (three separate `const x = stats.field` statements) instead of
destructuring.

**Suggested fix:** when splitting an object-destructure `VariableDeclaration`
into individual decls, emit them at the same source position / scope as the
original declaration rather than hoisting them to the enclosing top level.

## E. Rest-parameter *calls* are not packed into the vector

> **Status: fixed in transpiler** for the spread-of-a-vector case (`sum(...arr)` now passes the vector directly instead of `arr.begin(), arr.end()`). Pinned by `demo-6-regressions.test.ts > E`. The literal-args case (`sum(1, 2, 3)` into a rest param) still needs a function-signature table to detect the rest param at the call site; the demo uses a plain array parameter to cover both call shapes.

**Symptom:** `sumIds(1, 2, 3, 4, 5)` where `sumIds(...ids: int16_t[])` lowered
to `sumIds(1, 2, 3, 4, 5)` against a `const std::vector<int16_t>&` parameter —
g++ treated the first arg as the vector initializer: `invalid initialization
of reference of type 'const std::vector<short int>&' from expression of type
'int'`. Separately, `sumIds(...ids)` (spread of an array variable) lowered to
`sumIds(ids.begin(), ids.end())` — passing **iterators** instead of the
vector.

**Scope:** §3.2 marks rest params as ✅ → `std::vector<T>`. Rest-param
**declarations** lower correctly (the signature is right); the gap is the
**call site** — neither literal-arg packing nor array-spread packing produces
a vector argument.

**Workaround (applied):** `sumIds` takes a plain `int16_t[]` parameter; the
caller (`Forge.report`) builds the vector (`[1, 2, 3, 4, 5]`) and passes it.

**Suggested fix:** at a call site into a rest-param function, synthesize a
temporary `std::vector<T>{...}` from the literal/spread args and pass that.

## F. Generic function definition emitted in the `.cpp` (template link error)

> **Status: fixed in transpiler.** `emit/emitters/function-emitter-impl.ts` now routes exported generic-function definitions into the header (via the same buffer-swap the class emitter uses), so cross-file template instantiation links. Pinned by `demo-6-regressions.test.ts > F`. The demo's `complexity<T extends Recipe>` is now a real generic (the workaround is removed).

**Symptom:** `function complexity<T extends Recipe>(recipe: T): int16_t`
lowered to a correct `template<typename T> int16_t complexity(const T&)` — but
the **definition** was emitted in `Recipes.cpp`, while `main.cpp` instantiated
`complexity<Recipe>`. Linker: `undefined reference to 'short
complexity<Recipe>(Recipe const&)'`. A C++ template definition in a `.cpp` is
not visible to other TUs.

**Scope:** §1.11 marks generic functions as ✅ → `template<typename T>`. The
template *signature* is correctly emitted into the header; the gap is the
**definition** goes to the `.cpp` (where a non-template free function would
link fine, but a template will not).

**Workaround (applied):** `complexity` is a plain (non-generic) function
taking `Recipe` — there was only one instantiation anyway, so no genericity is
lost. (The constraint `T extends Recipe` meant `T` could only ever be
`Recipe`.)

**Suggested fix:** emit generic-function *definitions* into the header
(inline), not the `.cpp`, mirroring how generic-class methods are already
handled.

## G. Arrow function with explicit return type lowered to `void()`

> **Status: fixed in transpiler** for the return type. The `CallbackFunction` IR type now carries `returnType` + `typedParams`, and `emitCallbackFunctions` / the `friend` declarations render the real signature instead of hardcoded `void name()`. Pinned by `demo-6-regressions.test.ts > G`. The lambda *parameter* cppType currently renders as `auto` in the synthesized ISR signature (a remaining gap in the lambda-param type propagation); the link-breaking return-type piece is correct.

**Symptom:** passing an arrow `(): int16_t => { return checksum + offset; }`
as a `std::function<int16_t(int16_t)>` callback failed with `cannot convert
'void()' to 'std::function<short int(short int)>'`. The arrow's block body +
explicit `: int16_t` return annotation lowered to a `void()` signature (the
return type was dropped and the body became a no-op).

**Scope:** §3.4 marks arrow functions as ✅ and passing functions as
arguments as ✅ → `std::function`. Expression-bodied arrows lower correctly;
the gap is **block-bodied arrows with an explicit return-type annotation**.

**Workaround (applied):** the callback is a top-level named function
`addBudget(checksum: int16_t): int16_t`. The offset it needs is published to a
module-level `let budgetOffset` that the function reads. (Arrows that capture
are unreliable per §3.4's closure caveat anyway.)

**Suggested fix:** when lowering an arrow `ArrowFunctionExpression` with a
declared `returnType`, propagate that type to the synthesized
`std::function`/lambda signature instead of defaulting to `void`.

## H. `for (const T x : vec)` always by value — `-Wrange-loop-construct`

> **Status: fixed in transpiler.** `emit/statement-renderer.ts` now passes `isRef=true` to `renderTypedName` for non-primitive element types, emitting `const T& x` for class/struct elements and keeping primitives by value. Pinned by `demo-6-regressions.test.ts > H` (two tests: class element by reference, primitive by value). The `-Wrange-loop-construct` warnings are gone.

**Symptom:** every `for...of` over a struct/entry array emits
`for (const CatalogEntry entry : catalog)` (by value). g++ 15 warns:
`loop variable 'entry' creates a copy from type 'const CatalogEntry'
[-Wrange-loop-construct]; use reference type to prevent copying`.

**Scope:** §2.2 marks `for...of` as ✅. The lowering is functionally correct;
this is an **advisory warning**, not an error — `npm run compile` still exits
0. But it's noisy (the same warning fires once per TU that inlines the
method, so a header method referenced from N `.cpp` files warns N times), and
the copies are wasteful for larger structs.

**Status:** documented, not worked around (the warning doesn't fail the
build). A future emit improvement would emit `for (const T& x : vec)` (or
`const auto&`) for struct/element types heavier than a scalar.

**Suggested fix:** emit `for (const auto& x : vec)` (reference) instead of
`for (const auto x : vec)` (value) when the element type is a class/struct
type.

## I. Interface array field type is honored (positive data point)

When `Recipe.inputs` was typed `int16_t[]`, indexing yielded `int16_t` but
`amountOf(Material)` expected the enum — `cannot convert 'const short int' to
'Material'`. This is **correct** transpiler behavior (the interface said
`int16_t[]`); the fix was a source change (`inputs: Material[]`). Mentioned
here only because it was a real iteration step: interface array fields *do*
honor their element type (a `Material[]` field correctly became
`std::vector<Material>`), which is itself a good §1.6/§1.7 data point rather
than a bug.

## Build verdict

- **`npm run compile` exits 0.** Transpile + g++ + link all succeed.
- **Zero g++ errors, zero g++ warnings.** The `-Wrange-loop-construct`
  warnings (issue H) are gone — `for...of` now emits `const T& x` for
  class-typed elements.
- **The produced `Forge.exe` runs correctly** with deterministic output,
  byte-identical across repeated runs. All 20 successful crafts consume the
  full 40-unit ore stock (2 ore per smelt × 20 smelts); the residual stockpile
  (30 ingots, 4 coal) and the ore depletion record are sensible.
- **Full test suite: 1019 passed, 0 failed, 19 skipped** (69 files). The 10
  new regression tests in `tests/packages/transpiler/demo-6-regressions.test.ts`
  pin fixes A, C, D, E (spread), F, G, H, and the B lint rule.
