# Enum stress test — findings (cuttlefish, Arduino ESP32-S3)

> **STALE (2026-07-28):** `demos/demo/src/main.ts` was rewritten to showcase
> `@typecad/safety`'s `safe.read` feature; it no longer contains the enum
> stress-test sketch this writeup analyzes. Kept as a historical reference
> for the enum-lowering findings, which remain valid language-level claims.

A maximal enum showcase hammered the enum surface (SUPPORT_MATRIX §1.7) to
find where the claims break. Source: `demo/src/main.ts` (previous revision).
Originally developed against AVR; now targets the ESP32-S3
(`esp32:esp32s3:esp32s3`). The findings
below are language-level (enum lowering) and apply across architectures.
Covers numeric `const enum`, string enum, enum with gaps, enum as array index,
relational comparison, switch, string-enum comparison/concat,
enum-to-non-enum-param (the known gap), enum↔int storage boundary, enum in
arithmetic, bitwise flags.

## Finding A — string-enum-typed variable emits namespace name as C++ type

`const currentColor: Color = Color.Green` emits `Color currentColor = {};` —
but a string enum lowers to `namespace Color { ... }`, not a type. Should be
`const char* currentColor = Color::Green;`. Workaround: type as `string`.

## Finding B — top-level const typed as numeric enum not promoted to file scope

`const currentMode: Mode = Mode.Run` (top-level) emits as a LOCAL inside
`setup()`, invisible to `main()`. Other top-level consts ARE promoted to
file-scope globals; enum-typed ones are missed. Workaround: use `let`.

## Finding C — `as` cast erasure leaves enum↔int conversions un-bridged

`c as int32_t`, `n as Mode`, `m as int32_t` — the `as` is erased (no runtime
cast), but C++ `enum class` requires explicit `static_cast`. Multiple sites
fail. The SUPPORT_MATRIX handles this for specific sites (relational, index,
Map key, storage boundary) but not for the general `as` cast.

## Family I — enum-typed variable emission (A + B)
String-enum vars emit the namespace name as a type; numeric-enum top-level
consts aren't promoted to globals. Fix: lower string-enum var types to
`const char*`; ensure enum-typed consts get the same file-scope promotion.

## Family II — `as` cast erasure vs enum class (C)
When `as T` involves an `enum class` on one side and an integral on the other,
emit `static_cast<T>(...)` instead of erasing.

## What WORKS (confirmed)
Numeric const enum, enum with gaps, enum as array index, relational comparison,
switch, string enum comparison, enum↔int storage boundary (assign/var_decl),
enum member access in expressions.
