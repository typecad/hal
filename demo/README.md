# Caverns of Cuttlefish — cuttlefish demo

A small, deterministic, turn-based dungeon crawl written in TypeScript and
transpiled to C++ by cuttlefish (`@typecad/framework-native`). It exercises a
wide slice of the [SUPPORT_MATRIX.md](../SUPPORT_MATRIX.md) on a single
end-to-end program.

## Layout

```
demo/src/
  models/
    Types.ts       numeric + string enums, interfaces, tunable constants
    Entities.ts    Actor base + Player/Monster subclasses (inheritance, override,
                   static factory, pointer fields, getters)
  services/
    Rng.ts         seeded xorshift32 PRNG (private static state, static methods,
                   fixed-width int annotations, bitwise ops)
    Dungeon.ts     procedural map generator (2D array, nested loops, labelled
                   break, per-kind counters)
    Combat.ts      damage resolution, loot/flee rolls, switch, Math.*
  main.ts          game loop, movement, monster AI, end-of-run report
```

## Running

```bash
npm run compile      # transpile TS -> C++ and compile with g++
# binary lands in demo/src/out/.build/<name>.exe
```

The run is fully deterministic (seeded PRNG, fixed move schedule), so output
is reproducible across builds.

## SUPPORT_MATRIX patterns exercised

| Area | Pattern | Source |
|---|---|---|
| §1.2 | `int32_t` pass-through annotations | `Rng.ts` |
| §1.4 | string concat → snprintf | all files |
| §1.6 | `interface` → `struct` | `Position`, `Entity` |
| §1.7 | numeric + string enums | `TileKind`, `Direction`, `GameStatus`, `Outcome` |
| §1.7 | enum comparison (relational + equality) | `Dungeon`, `main.ts` |
| §2.2 | `for`, `for...of`, `while`, nested loops | `Dungeon.generate`, `main.ts` |
| §2.3 | labelled break | `Dungeon.placeStairs` |
| §2.4 | `switch` | `Combat.describeOutcome`, `Dungeon.glyphFor` |
| §3.1 | free functions, hoisting | `clamp`, `step`, `greedyDirection` |
| §4.1 | classes, visibility, static methods/fields | `Rng`, `Dungeon`, `Actor` |
| §4.2 | constructor params, `this.field` | all classes |
| §4.3 | getters, `override` | `Actor.healthFraction`, `Player/Monster.glyph` |
| §4.4 | `extends`, `super(...)`, virtual dtor | `Player extends Actor`, `Monster extends Actor` |
| §4.5 | pointer fields, `->` chains | `Player*`, `Monster*` arrays |
| §5.1 | arithmetic, bitwise, compound assign | `Rng.next` (xorshift) |
| §5.2 | `Math.floor/min/max` | `Rng`, `Combat`, `main.ts` |
| §5.3 | `.push`, `.length` | monster arrays, damage log |
| §6.1 | top-level statements → `main()` | `main.ts` tail |
| §6.2 | multi-file local imports | every file |

---

# Transpilation issues — status after fixes

This demo was originally written to surface cuttlefish transpiler gaps. The
gaps below were reported, triaged, and most have been fixed in the transpiler
source. Each entry shows the current status.

Legend: ✅ Fixed in transpiler · 🟨 Worked around in demo (gap remains) · ⚪ Stale
(was already fixed / not reproducible).

## ✅ Fixed in the transpiler

These required source changes in `packages/cuttlefish/src` (or
`packages/framework-native/src`); the demo now uses the natural idiom.

1. **`new Map<K,V>()` / `new Set<K,V>()` with type arguments leaked the TS
   syntax verbatim.** The `Map`/`Set` short-circuit checked the ctor name
   *after* type args were appended, so it never matched.
   Fixed in `ir/expression-to-ir.ts` — capture the base ctor name before
   appending type args. *(F1)*

2. **`<cstdint>` wasn't included by the native framework**, so `int32_t` /
   `uint8_t` pass-through annotations failed to compile.
   Fixed in `packages/framework-native/src/strategy.ts` —
   `forcedIncludes()` now returns `['<cctype>', '<cstdint>']`. *(F2)*

3. **`private static` fields lost the `static` qualifier**, producing a
   non-static member accessed via `Class::field`.
   Fixed in `ir/declaration-builders.ts` (capture `isStatic` on field IR) and
   `emit/emitters/class-emitter.ts` (emit `static inline ` prefix in all
   three visibility sections). *(F3)*

4. **Enum `==`/`!=` only cast one side** when the LHS was a local assigned
   from a method call (its enum return type wasn't propagated), producing
   `TileKind == int` which `enum class` rejects.
   Fixed in `emit/expression-renderer.ts` — when exactly one side is a known
   enum operand and the other side's type is unknown/auto, cast the unknown
   side too (`static_cast<int>` is always safe on a scalar). *(F4)*

5. **Labelled `break` lowered to a `goto` whose label sat at the function's
   closing brace**, triggering `-Wc++23-extensions` and unused-label warnings.
   Fixed in `emit/emitters/line-appender.ts` — emit a trailing `;` no-op
   after the label. *(F9)*

6. **Generic call-site emitted a literal `T`** as the variable type
   (`const T x = clamp(...)`), because the function return-type map stored the
   unresolved type-parameter name.
   Fixed in `ir/type-resolution.ts` (`buildFunctionReturnTypeMap`) — when the
   annotated return type is itself a type-parameter name, store `"auto"`. *(F10)*

7. **`let` arrays mutated via `.push()` were promoted to `const std::vector`**
   by the ownership analysis (it only counted `assign`/`update` IR kinds, not
   mutating method calls), so `push_back` failed to compile.
   Fixed in `ir/ownership-analysis.ts` — `scanStmtsForAssignments` now flags a
   `let` var as assigned when it's the receiver of a mutating array method
   (`push`/`push_back`/`pop`/`shift`/`splice`/`sort`/`fill`/`reverse`/…). *(F8)*

8. **`.filter()` on a runtime-sized array** (one grown via `.push()` or
   initialised as `[]`) produced a zero-length fixed C array and a
   `for (... < 0; ...)` loop that never ran.
   Fixed in `ir/transformers/variables.ts` — only inline-lower filter when the
   source has a known, **non-zero** literal size; otherwise fall through to
   the `__tc_filter` polyfill, which returns a `std::vector<T>`. *(F7)*

9. **`??` lowering referenced `cuttlefish_nullish` from a non-entry header**
   that didn't emit the helper (only the entry file got the full shim).
   Fixed in `ir/program-analysis.ts` + `emit/emitters/setup.ts` — a new
   `usesNullishHelper` flag distinguishes "actual `cuttlefish_nullish(...)` call"
   from "bare `null` literal"; non-entry headers that emit the call now get the
   full shim block (idempotent via `#ifndef`). *(F6)*

10. **`as const` top-level object member access (`CONFIG.width`) rendered as
    `CONFIG::width`** (scope-resolution) instead of `CONFIG.width` (member
    access), because the IR flagged the variable `isStatic`.
    Fixed in `emit/expression-renderer.ts` — when the object is a known
    top-level const object (in `knownTopLevelObjectTypes`), use `.` access. *(F12)*

## 🟨 Remaining gaps (worked around in the demo)

These are real but lower-impact; the demo uses a clean, commented alternative.

- **`Object.keys(mapInstance)` on a class field** lowers to
  `0 /* unsupported_expr */`. `Object.keys` is supported on map *locals/params*
  (§5.4) but not on a class-typed field. `Dungeon` keeps per-kind numeric
  counters instead of a `Map<string, number>`. *(F5)*
- **`.filter()` callback on a pointer array** (`m => m.alive()`) mis-lowers
  the generated callback signature (`void main_isr_0()` with no parameter).
  The `__tc_filter` polyfill itself works; the per-call callback emission for
  method-call bodies on pointer arrays needs more work. `main.ts` uses a
  manual count loop. *(F7 follow-up)*
- **`as const` object emission across split-file headers** still redefines the
  synthesized `struct _CONFIG_t` in each header that includes it. The
  member-access fix (F12) is correct, but the struct needs an include guard.
  The demo uses individual `const` bindings for tunables. *(F12 follow-up)*
- **object-literal brace-init passed to a `const T&` parameter** (e.g.
  `Monster.spawn({x, y}, 1)`) lowers the literal to an anonymous struct that
  doesn't match the named `Position`. The demo assigns to a typed local first. *(F11)*

## ⚪ Stale (verified already fixed)

- **`null` literal → `nullptr_` typo.** Already guarded in
  `emit/expression-renderer.ts:236-247` — `null`/`undefined` route through
  `strategy.nullValue()` before keyword escaping.
- **`%` on `double` operands.** Already lowered to `fmod(...)` in
  `emit/expression-renderer.ts:735-739` when either operand's inferred type is
  `double`/`float`. (The demo annotates integer-domain values `int32_t` so they
  stay in integer domain regardless.)

## Patterns that worked cleanly (no workaround needed)

- class inheritance + `super(...)` → C++ initializer list (§4.4)
- `virtual ~Actor() = default` on a polymorphic base (§4.4)
- `override` keyword on subclass methods (§4.3)
- `Player*`/`Monster*` pointer fields with `->` member access (§4.5)
- static factory methods returning `new Derived(...)` (§4.1, §4.5)
- `private static` fields with initializers → `static inline` (§4.1)
- 2D array `TileKind[][]` → `std::vector<std::vector<TileKind>>` (§1.5)
- `for...of` over a pointer array with `->` access (§4.5)
- `switch` with string/enum discriminators (§2.4)
- labelled `break scan;` out of nested loops (§2.3)
- enum `==`/`!==` comparisons on method-return locals (§1.7)
- `let arr = []; arr.push(x)` kept mutable (§5.3)
- `.filter()` on literal-sized arrays → C array (§5.3)
- `Math.floor/min/max` → `std::floor/min/max` (§5.2)
- multi-file local imports inlined into one program (§6.2)
- top-level statements flowing into `main()` (§6.1)
