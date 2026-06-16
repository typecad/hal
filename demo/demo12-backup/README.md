# Cipher — cuttlefish demo #12

An **encoding/codec toolkit** written in idiomatic TypeScript and transpiled to
C++ by cuttlefish (`@typecad/framework-native`). Exercises sort-with-comparator,
`while(true)` with break, standalone block, variable-in-case, `new Float32Array(n)`,
`NonNullable<T>`, `int`→`double` promotion, and class static constants.

This is the **twelfth** demo iteration. It targets a fresh slice of the
SUPPORT_MATRIX that demos #1–#11 left untested (⬜):

- §5.3 Math-method comparator via `.sort` (fixed — Finding E)
- §4.7 static constants inside a class
- §2.2 `while(true)` with break
- §2.5 standalone block `{ ... }`
- §2.4 variable in case expression
- §1.3 `int` return promoted to `double`
- §1.7 `NonNullable<T>`
- §1.5 `new Float32Array(n)` zero-init
- §3.1 `export default function` (documented gap)

## Layout

```
demo/src/
  models/Codec.ts   codec class, sort, buffer, encode.
  main.ts           driver.
```

Demo #11's files are preserved under `demo/demo11-backup/`.

## Running

```bash
npm run lint && npm run compile   # exits 0; binary in demo/src/out/.build/
```

## Sample output

```
ascii_a=65 ascii_z=90
checksum=60
sorted_0=1
found=5
scoped=21
classify_short=10
classify_long=30
avg=5
buffer_0=1.500000
encode_D=3
safe=0
done: checksum=60 found=5 sorted_0=1
```

`sorted_0=1` correct (sort fix works). `safe=0` is a snprintf format-spec gap
(Finding F — the `NonNullable<T>`-typed value uses `%d` instead of `%g`).

---

# Transpilation issues found by Demo #12

Demo #12 surfaced six issues. **One is fixed** (E); **five are documented** (A–D, F).

## Fixed

| # | Finding | Fix | File(s) |
|---|---|---|---|
| E | `.sort(comparator)` produced the wrong order (reversed input, not sorted) | The `__tc_sort_fn` polyfill now wraps the comparator: `comp(a, b) < 0` converts the TS convention (negative = before) to `std::sort`'s convention (true = before) | `packages/framework-native/src/strategy.ts` |

## Documented

| # | Finding | Workaround |
|---|---|---|
| A | `forEach` on a runtime vector isn't lowered (callback ISR can't capture locals) | Use a manual `for` loop |
| B | In-class `.sort(comparator)` — the module-level comparator isn't visible from the inlined class method body | Move the sort call to a module-level free function |
| C | `export default function name()` — the inline `FunctionExpression` isn't processed by the function builder (only standalone `FunctionDeclaration`s are) | Use a named `export function` |
| D | Top-level `new Float32Array(n)` — `extern float*` in the header vs `float[]` definition (pointer-vs-array mismatch) | Wrap the typed array in a function to keep it stack-local |
| F | `NonNullable<T>` value + `snprintf` — the format specifier doesn't resolve the alias-to-`double` (uses `%d` instead of `%g`) | Use `number` directly, or cast the value in the template literal |

## Build verdict

- **`npm run compile` exits 0.** The binary runs with correct sort output.
- **Regression tests: 1 test** in `demo-12-regressions.test.ts` (sort comparator
  convention); the full transpiler suite is **186 passed, 2 skipped, 0 failed** (19 files).
