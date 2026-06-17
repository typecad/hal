# Round-Robin Task Scheduler — cuttlefish demo #14

A **priority / round-robin task scheduler** simulation written in idiomatic
TypeScript and transpiled to C++ by cuttlefish (`@typecad/framework-native`).
A small fixed workload of sensor/telemetry/control/diagnostics tasks is
enqueued into a `PriorityScheduler` and dispatched one quantum at a time until
the ready queue drains, with per-tick reporting and a final summary.

This is the **fourteenth** demo iteration. It is written in its **idiomatic
form** — the seven transpilation gaps it originally surfaced have all been
fixed or lint-gated in the transpiler, so the source uses getters, a
struct-returning `peek(): Task | null`, a subclass with no explicit
constructor, `int32_t` template interpolation, and a same-file helper called
from a class body, with no workarounds.

It exercises a broad slice of the SUPPORT_MATRIX:

- §1.5  `Map<string, Task>`, `Map<string, int32_t>`, `Set<int32_t>`, `Task[]`
- §1.6  interfaces → C++ structs (`Task`, `TickResult`)
- §1.7  numeric enum with explicit bit-flag values; bitwise membership (`&`)
- §1.4  template literals; string methods (`toUpperCase`)
- §1.8  `T | null` struct return (now value-inits); `Map.get()!` non-null
- §2.2  bounded `while` with `break`; `for...of` over `Set`/array
- §2.4  numeric `switch` with `default`
- §2.5  `try` / `catch` / `throw` on the native target
- §3.1  multi-file module structure (`models/Task|util|Scheduler` + driver)
- §3.4  module-level free function used as an `Array.sort` comparator
- §4.1–4.5 class fields, parameter-property constructor, instance + static
            **getters**, inheritance, `abstract` base (pure virtual), a
            subclass with **no explicit constructor**, virtual override
- §5.1  arithmetic / comparison / compound assignment; enum bitwise `&`
- §5.2  `Math.min` / `Math.max`
- §5.3  `Array.sort(comparator)`, `Array.push`, `.length`, string `.toUpperCase`

## Running

```bash
npm run lint      # ESLint with the cuttlefish transpiler-rules plugin
npm run compile   # transpile TS -> C++ and compile with g++
# binary lands in demo/src/out/.build/main.exe
```

`npm run compile` exits **0**; the binary runs with correct output.

## Sample output

```
loaded=5 urgent=2
tick=1 [PID#3] ran=3 used=2 left=5
tick=2 [PID#3] ran=3 used=1 left=4
tick=3 [WATCHDOG#5] ran=5 used=2 left=3
tick=4 [TEMP#1] ran=1 used=2 left=3
tick=5 [TEMP#1] ran=1 used=2 left=2
tick=6 [DOWNLINK#2] ran=2 used=2 left=2
tick=7 [DOWNLINK#2] ran=2 used=2 left=2
tick=8 [DOWNLINK#2] ran=2 used=2 left=1
tick=9 [SELFTEST#4] ran=4 used=2 left=1
tick=10 [SELFTEST#4] ran=4 used=2 left=1
tick=11 [SELFTEST#4] ran=4 used=1 left=0
tick=12 idle
dispatches=11
sev_err=100
clamp=10
done
```

Scheduling verified by hand: priority order `pid(9) > watchdog(8) > temp(5)
> downlink(3) > selftest(1)` with quantum 2; each task's consumed ticks equal
its burst, the queue drains to `left=0`, and `dispatches=11` matches the 11
non-idle ticks.

---

# Transpilation issues found by Demo #14 — RESOLVED

Demo #14 surfaced seven issues. **Five are fixed in the transpiler** (A, B, D,
E, G), **one is lint-gated** (C), and **one was a stale diagnostic removed**
(F). Pinned by `tests/packages/transpiler/demo-14-regressions.test.ts`
(13 tests).

## Fixed in the transpiler

| # | Finding | Fix | File(s) |
|---|---|---|---|
| A | A function/method returning `T \| null` (struct T) emitted `return CUTTLEFISH_UNDEFINED;` / `return nullptr;` — invalid for a struct return, and `map.get() ?? null` produced `cuttlefish_nullish(.., nullptr)`. | `ReturnIR` now carries `functionReturnType`; the return renderer lowers a nullish return value to `return {};` (value-init) when the enclosing return type is a struct. Free functions AND methods annotate the type (methods register it in `declaration-builders.ts`). | `api/shared/ir-core.ts`, `ir/transformers/control-flow.ts`, `ir/declaration-builders.ts`, `emit/statement-renderer.ts` |
| B | A subclass with no explicit constructor emitted **no constructor** (C++ doesn't inherit ctors), so `new Sub(args)` failed. | A post-pass in `buildProgramIR` synthesizes a forwarding constructor mirroring the base's signature (`Sub(args) : Base(args) {}`) or an empty ctor for a default-constructible base. | `ir/build-ir.ts` |
| D | A same-file free function declared after a class was not in scope for the class's inline method bodies (`'fn' was not declared in this scope`). | `emitFunctionForwardDeclarations` now emits all free-function prototypes + ISR callbacks into the source buffer BEFORE class bodies (cpp-emitter step 6.5); the duplicate post-class emission was removed. | `emit/emitters/function-emitter-impl.ts` |
| E | Static-getter access (`Cls.x`) emitted `Cls::x` instead of `Cls::getX()`; getter access on an **imported** (cross-file) class never rewrote. | The static branch rewrites to `Cls::getX()`; cross-file class accessor names are aggregated across the module graph (`crossModuleClassAccessors`) and merged into the per-file accessor map. (Instance getters were already correct.) | `emit/expression-renderer.ts`, `emit/emitters/emitter-context.ts`, `emit/emitters/setup.ts`, `transpile.ts` |
| G | Template-literal interpolation of `int32_t`/`uint32_t` emitted `%ld`, triggering `-Wformat=` (they are `int` typedefs). | Format-specifier selection now maps `int32_t`→`%d`, `uint32_t`/`uint16_t`→`%u`; `long` keeps `%ld` (a distinct C++ type). | `emit/expression-renderer.ts`, `emit/snprintf-helpers.ts` |

## Lint-gated (impossible to transpile correctly)

| # | Finding | Resolution |
|---|---|---|
| C | Mutating a field of a struct fetched via `Map.get()` is lost (or a compile error on a `const` binding) — there is no TS→C++ reference binding; `map.get(k)` lowers to a value copy. | New ESLint rule **`no-map-struct-mutation`** errors at lint time (in both the repo-root plugin and the scaffolded `eslint-transpiler-rules.mjs`). The idiomatic workaround — keep mutable per-entry state in a separate primitive `Map` and `.set()` back — is what this demo uses. Marked 🚫 in SUPPORT_MATRIX §1.5. |

## Stale diagnostic removed

| # | Finding | Resolution |
|---|---|---|
| F | `TS2CPP_NO_EQUIVALENT` warned "String-valued enum members have no C++ equivalent", but string enums ARE lowered (to a `namespace` of `constexpr const char*`). | Removed the contradictory warning in `feature-registry.ts`; string enums are ✅ supported. |

## Persistence to new projects

- The `no-map-struct-mutation` rule is emitted into every scaffolded project's
  `eslint-transpiler-rules.mjs` and enabled in its `eslint.config.mjs`.
- The scaffolded `package.json` now includes `eslint` + `@typescript-eslint/*`
  devDependencies and a `lint` script (a pre-existing latent gap — the config
  imported them but the package.json didn't declare them).

## Build verdict

- **`npm run lint` exits 0.** **`npm run compile` exits 0.**
- **The binary runs with all-correct output**, verified by hand.
- **Full transpiler suite: 1082 passed, 19 skipped, 0 failed** (78 files).
