# ts-patterns — TypeScript pattern gallery

A single deterministic program that exercises the common idiomatic TypeScript
patterns and prints its computed results over the board's UART0 console
(esp32s3_devkitc/esp32s3/procpu). It exists to answer two questions with
evidence instead of folklore:

1. **Which idiomatic TS patterns does the transpiler lower correctly?**
2. **Which patterns are unsupported or broken — and what is the idiomatic
   embedded replacement?**

## Run it

```sh
cd demos/ts-patterns
npx typecad-hal build              # transpile → out/src/*.cpp
npx typecad-hal build --compile    # + west build → zephyr.elf
npx typecad-hal build --compile --upload --monitor --port COM9
```

Flash and console share the on-board CH343 USB-UART bridge (`COM9` on this
machine — override with `--port`).

**Verified on hardware**: the flashed gallery's UART output is
byte-for-byte identical to the Node oracle's (2,892 bytes, V01 → X13 →
`gallery complete`).

## The report seam

Every section prints through one function (`src/report.ts`):

```ts
export function report(line: string): void {
  UART0.writeLine(line);
}
```

That single seam is what lets the same sources run in three worlds:

- **Zephyr** — the CLI build above (`report` → `__tc_println` over UART0).
- **Differential execution** — `tests/packages/cuttlefish/ts-patterns-gallery.test.ts`
  swaps the import for `declare function report(line: string): void;`, runs
  each module under Node (the JS-semantics oracle) and as
  transpiled→host-g++→native, and requires **identical stdout**. A mismatch
  is a transpiler semantic bug.
- **`src/array-methods.ts`** — the callback-method coverage (map/filter/
  reduce/find/findIndex/some/every/forEach/sort/join/multi-arg-push). It is
  deliberately NOT imported by `main.ts`: firmware targets ban these
  methods outright (see findings), so it only runs in the differential
  harness.

Section order and every printed value are fixed; the sources are
deterministic by construction.

## Pattern coverage (main.ts)

| Section | Patterns |
| --- | --- |
| 01 · variables | `var`/`let`/`const` + shadowing, annotations and inference, hex/binary/octal/exponent literals, string escapes, template literals (incl. multiline and one nesting level via an intermediate const), literal unions, numeric+string enums, typed arrays, destructuring (object with defaults, rename, nested, array with rest, swap), array spread, `??` / `?.` on nullable bindings, compound assignment, `++`/`--`, `**=`, the bitwise family with `>>>` |
| 02 · functions | declarations, function expressions, concise/block arrows, defaulted and optional parameters, rest parameters, object destructuring in parameters, function type aliases, `std::function` callbacks, higher-order functions and composition, closures over parameters, forEach folds over captured locals, direct + mutual recursion, generic functions with constraints, void functions, early returns, optional calls (`cb?.()`) |
| 03 · objects | data-only object literals (nested, mixed member types), dot access, explicit field-by-field merge, the presence-flag idiom, method-bearing `interface` + `implements` with class instances, structural typing through parameters, `Map`/`Set` (set/has/size/delete) with a parallel key array |
| 04 · arrays | literals (nested, typed), element access, `push`/`pop`/`shift`/`unshift`, `indexOf`/`includes`, explicit string-building folds, insertion sorts (comparator form), staged pipelines, `for`/`for-of`/`while`/`do-while`, fixed-capacity buffers (`new Array<T>(n)`), destructuring with holes and rest, spread copies, index-swap, element-wise reads |
| 05 · classes | fields with initializers, constructors with parameter properties, `private`/`protected`/`readonly`, static members, getters, `extends` + `super(args)` + `override`, abstract classes with polymorphic dispatch, interface-typed containers (`Shape[]`), virtual-tag dispatch (the `instanceof` replacement), composition, method chaining (`return this`) |
| 06 · control flow | `if`/`else-if` chains, `switch` over numbers/strings/enums with grouped cases, labeled `break`/`continue`, `while`/`do-while` semantics, ternaries, `Math.*`, `Number`/`parseFloat`/`parseInt`, radix conversion via a divmod loop, `toFixed`, `charCodeAt`/`charAt`, lexicographic comparison |

Non-integer values are printed through `toFixed()` — raw double
interpolation renders differently per target, and matching output is part
of what the gallery asserts.

## Findings — status after the fix pass

Seven of the broken patterns are now **properly lowered and
differentially verified** (tests/packages/cuttlefish/broken-patterns-0.test.ts):

- `for (const i in arr)` yields indices (index-loop lowering; the
  declaration-less form reports an unsupported diagnostic).
- Stateful closures: the counter factory compiles — the mutation scan sees
  lambda bodies and escaping closures capture `[=] mutable`.
- `&&`/`||` short-circuit: the left operand hoists into a temp (side
  effects once), string conditions guard on emptiness, and int/int
  ternaries carry their type into the printf argument.
- `cb?.(args)` in statement position emits a real `if (cb)` guard — an
  undefined callback no longer constructs an empty `std::function` and
  invokes it.
- Aliased cross-module imports (`import { runHelper as rh }`) — call sites
  lower under the exported name and the defining module declares/defines it.
- Generic-class allocation: `new Stack<number>()` normalizes to
  `Stack<double>` in both the declared type and the new-expression.
- `std::string`-valued logical operands inside printf arguments: the
  hoisted short-circuit temp substitutes into the IR so the `.c_str()`
  decision fires (`report('c=' + ('' || 'x'))` prints `c=x`).
- Bare spread copies verified working on both tiers (stale-cache
  misdiagnosis in the original survey).
- `const p: Point = { ... }` allocates (`new Point{ ... }`) instead of
  emitting the ill-formed `T* p = { ... }`; member writes through the
  binding mutate in place.
- Optional parameters (`port?: number`) become defaulted C++ parameters
  with the type's zero value.
- A bare `super()` renders as a no-op (base construction rides the
  member-initializer list), and derived ISR identifiers are sanitized for
  digit-leading module names.

**Fixed since the survey** (differentially verified in
broken-patterns-0.test.ts): bare spread copies (verified working on both
tiers), aliased cross-module imports (`import { runHelper as rh }` — the
call site and the module's declaration/definition both key on the exported
name), generic-class allocation (`new Stack<number>()` normalizes to
`Stack<double>` in both the declared type and the new-expression), the
`std::string`-valued logical operand in a printf argument (the hoisted
temp substitutes into the IR, so the `.c_str()` decision fires), string
truthiness in ternary conditions, and `if (cb)` guards for optional calls.

**Fixed in the second pass** (also in broken-patterns-0.test.ts):
`if (s)` statement truthiness (string conditions guard on emptiness),
mixed-type `??` on `number | null` parameters (nullish shim emission is
order-proof — the lowering registers `nullishHelperSeen` on the build
context), string-array destructuring and array-returning helpers in the
common annotated shapes (verified clean; the earlier failures were
stale-cache artifacts).

**Fixed in the second pass** (also differentially verified): aliased
cross-module imports, generic-class allocation, `std::string`-valued
logical operands in printf args, bare spread copies (stale-cache
misdiagnosis), `if (s)` statement truthiness, mixed-type `??` on
`number | null` params (order-proof shim trigger), string-array
destructuring and array-returning helpers in the common annotated shapes.

**Fixed in the third pass:** generic-class instance METHOD dispatch works
end to end — the hosted-array block skips new-allocated receivers
(`.push` stays a user method), `.pop()` value-preserves via `__tc_pop`,
and a generic method's return resolves through the receiver's
instantiation (`s.pop()` on `Stack<number>` yields double, not bare `T`).

**Fixed in the fourth pass:** heterogeneous tuples —
`const pair: [number, string] = [7, 'seven']` lowers to
`std::tuple<double, std::string>` with `std::get<N>` index access and
per-element printf typing (`%s` + `.c_str()` for a string element).

**Fixed in the fifth pass:** `typeof` narrowing over a union now lowers
soundly — the guard emits `std::holds_alternative<Arm>(id)` at runtime,
the then-branch reads the narrowed arm through `std::get<Arm>(id)`
(branch-scoped narrowing context), the else-branch string interpolation
of the variant emits its single string arm, and passing a literal/variant
to a variant-typed parameter brace-constructs the variant (int args cast
to the numeric arm to avoid ambiguity). The `no-typeof-narrowing` lint
rule now only fires on shapes the lowering does not support (e.g.
`typeof x !== 'lit'` over multi-arm matches).

**Still open (avoid; documented workarounds):** raw double concat
formatting (`'v=' + n` on a double prints `7` in Node vs the embedded
formatter natively — use `toFixed()`); tuple indexing beyond two
elements and mixed tuple/string interop follow the same proven pattern.
Variant narrowing in the ELSE branch of a typeof guard (complement arms)
and multi-arm matches are not modeled — the plain union remains
whole-variant there.

## Original findings (pre-fix survey)

Each of these was verified against the current tree (both the Zephyr CLI
path and the native differential path where applicable). The gallery avoids
them; the ESLint ruleset flags the mechanical ones at build time.

**Silent wrong code (worst class):**

- `typeof x === 'literal'` narrowing lowers the guard to a constant
  `if (false)` — the other branch never runs. → rule `no-typeof-narrowing`.
- `for (const i in arr)` iterates **values** and then indexes with them
  (`arr[8]` → out-of-bounds). Use an index `for`.
- `&&`/`||` do **not short-circuit** on the native tier (both sides
  evaluate). Side-effecting guards are unsafe.
- `.map()`/`.filter()` results on annotated `number[]` arrays render as C
  arrays; `.length`/`.size` on them is a compile error, and indexing past
  the written range reads garbage.
- A lambda body that builds a string hoists its `snprintf` above the
  lambda — the callback parameter is then out of scope
  (`'n' was not declared`). Value-returning callbacks are safe.
- The ownership pass emits a captured local as `const` even when a returned
  lambda mutates it (the classic counter factory) — g++: *assignment of
  read-only variable*.
- `?.()` on an empty `std::function` crashes the native tier: the nullish
  guard cannot detect an empty function.

**Compile errors with confusing g++ messages:**

- An object literal bound to an interface/class-annotated variable, passed
  as an interface-typed argument, or returned from an interface-typed
  function emits `T* name = { ... }` — ill-formed C++. → rule
  `no-interface-literal-binding`; use class instances or unannotated
  literals.
- `new Stack<number>()` emits the unresolved name `number` as a template
  argument. → rule `no-generic-new-primitive`.
- `set` accessors lower to an rvalue assignment. → rule `no-set-accessors`.
- A function whose declared return type is `T[]` renders a C-array return
  ("function returning an array"). → rule `no-array-returning-function`.
- `arr.push(a, b)` has no fixed-capacity lowering. → rule
  `no-multi-arg-push`.
- A bare `super()` against a base without a constructor crashes the emitter
  ("unsupported StatementIR kind 'super_call'"). → rule `no-bare-super-call`.
- A `let` mutated from inside a lambda is emitted `const` (see above);
  module-level state mutated from callbacks is the supported shape.
- Passing an array to a user function promotes it to the fixed-capacity
  wrapper, whose elements no longer bind to `std::vector` parameters —
  array helpers must be inlined at this program scale.
- String-array destructuring reads garbage on the native tier (number
  arrays are fine).
- `[swap[0], swap[1]] = [swap[1], swap[0]]` evaluates element-wise
  natively and loses the swap — use a temp.
- A `let`/`const` at file scope whose initializer is a template literal or
  object may not be emitted at all in flat (single-file) mode — keep
  runtime data inside functions.
- Aliased cross-module imports (`import { run as r }`) lose the symbol;
  digit-leading module file names produce invalid C identifiers
  (`04-arrays_isr_0`) — letter-first names and plain import names only.
- Number/string format inference mis-assigns printf specifiers when a
  template mixes numbers with `toFixed` strings and booleans — route
  booleans through ternaries and stringify numbers.

**Banned by lint (by design — fixed-shape embedded model):** object spread,
`Object.keys` beyond Maps, `Map.keys()`, dynamic string-keyed access, `this`
in free functions (object-literal methods), `keyof`, IIFEs, `instanceof` on
user hierarchies, `Array.slice` (lowers through the string helper),
`sort`/`join`, optional-field `??`/`undefined` compares, `null` flowing
into string parameters (crashes the native runtime),
`??` between differently-typed operands.

## Gallery-related rules and tests

- `eslint-transpiler-rules.mjs` (generated from
  `packages/cuttlefish/src/create/eslint-rules-template.ts`): seven new
  rules — `no-interface-literal-binding`, `no-set-accessors`,
  `no-typeof-narrowing`, `no-generic-new-primitive`,
  `no-array-returning-function`, `no-multi-arg-push`,
  `no-bare-super-call`.
- `tests/packages/cuttlefish/eslint-rules-gallery.test.ts` — each rule
  fires on a bad sample, stays quiet on the supported form, and the gallery
  sources are asserted clean under the whole ruleset.
- `tests/packages/cuttlefish/ts-patterns-gallery.test.ts` — the
  differential execution contract for `main.ts` and `array-methods.ts`.
