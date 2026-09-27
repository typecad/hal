---
'@typecad/cuttlefish': minor
'@typecad/framework-zephyr': minor
---

Port-gap fixes — engine gaps surfaced by porting real Arduino/C++ firmware
(the Mod-EC I2C salinity slave), each reproduced by a test in
`tests/packages/cuttlefish/port-gap-fixes.test.ts`:

- **Math builtins with no `std::` equivalent.** `Math.fround` lowers to
  `static_cast<float>(...)` and `Math.sign` to a NaN-preserving ternary —
  the old generic fallback emitted `std::fround`/`std::sign`, which do not
  exist. The global `Infinity`/`NaN` identifiers lower to the `INFINITY`/
  `NAN` macros and trip the math-header include scan.
- **Method-bearing interfaces now emit.** A TS interface with methods
  (KeyValueStore) used to emit NOTHING — every reference to the type was
  undefined in C++. It now lowers to an abstract struct (pure-virtual
  methods + virtual dtor); `implements` of a method-bearing interface
  emits real inheritance. Field-only interfaces stay plain aggregate
  structs.
- **Class-field initializer inference.** An un-annotated field no longer
  falls back to `auto` (illegal on non-static members): fractional
  literals infer `double`, `new X()` infers `X*`. A double-typed field
  also stamps its numeric initializer so `double k = 0.019` keeps f64
  precision instead of rounding through a float `f` suffix.
- **Getter const-qualification is now call-graph safe.** Getters were
  unconditionally `const`; one calling a non-const sibling did not
  compile. A per-class fixpoint now qualifies only getters that write no
  receiver member and call no non-const sibling (getter-to-getter chains
  included).
- **`.fill()` on embedded arrays.** The `__tc_StaticArray` wrapper gained
  `fill` (both arities), a `std::vector` receiver on a no-STL target
  lowers to `std::fill` (+ `<algorithm>`), and the static_array polyfill
  is now gated on the variable's TYPE (analysis also covers hoisted HAL
  callback bodies), so the wrapper's definition always ships when the
  type is used.
- **Top-level runtime vars referenced only as receivers of nested calls**
  (`f(probe.measure())`) are promoted to file-scope globals like every
  other function-referenced var — the identifier scan now covers
  call/method-call expressions in argument position.
- **HAL-object class fields.** A field initialized with
  `new <HALClass>(...)` resolves its `this.field` HAL calls to real ops
  (previously raw text naming the nonexistent C++ class) and emits no C++
  declaration; `instance.field` receivers resolve in any module build
  order (the instance rides the class IR). The HAL ctor map now
  understands the `typeof x === 'number' ? x : x.number` narrowing idiom
  and resolves pin-constant args (`GPIO4` → 4).
- **Bitwise ops on real-typed operands** (`Math.trunc(x) & 0xff`, the
  canonical port pattern) cast through `static_cast<int>` — C++ has no
  `double & int`; compound assignments (`x &= 0xff` on a double) rewrite to
  the same cast form. `Math.trunc` (and the other real-returning Math
  methods) now report `double` to expression inference.
- **Round 2 (sibling sweep of the same classes).** `Math.clz32`/`Math.imul`
  lower to real expressions (no `std::clz32`/`std::imul` exists).
  `Number(x)` casts (string args parse via `atof`); `parseInt`/`parseFloat`
  only grow `.c_str()` for genuine `std::string` args. Un-annotated function
  params default to `double` — the old `const auto& x` is illegal C++14 on
  the embedded targets. `new Array<E>(n)`/`new Map<K,V>()`/`new Set<T>()`
  infer their value-container types instead of nonexistent `Array<E>*`/
  `Map<K,V>*` pointers. The `__tc_StaticArray` wrapper gained
  `shift`/`unshift`/`includes`/`lastIndexOf`, and array receivers emit
  structured method-call IR with a parenthesized receiver so the
  strategy-level string-method regex can no longer hijack them
  (`a.includes(2)` used to become `strstr(a, 2)`). `array.join()` and
  `Map.keys()` fail the transpile with actionable diagnostics on targets
  that have no lowering for them. The HAL registry now warms before the
  cross-module class prebuild, and instance-field HAL receivers prefer the
  import-resolved field map — so `probe.pin.onInterrupt(...)` in the entry
  file resolves with the pin constant folded regardless of module build
  order.
- **Round 3 (std:: surface audit).** Every std function the engine emits
  now carries its header and its target exists: the math-include scan
  covers the full emitted set (`isnan`/`isfinite`/`log2`/`hypot`/`cbrt`/
  hyperbolics shipped with no `<cmath>`); `Math.round` uses the JS half-up
  rule (`std::floor(x + 0.5)`, not `std::round`'s half-away-from-zero);
  `new Error(...)` as a value infers `std::runtime_error` (not the
  nonexistent `Error*`) and registers `<stdexcept>` on hosted targets,
  while on no-exception targets it fails loudly — `throw new Error(...)`
  still lowers to `cuttlefish_halt` there; regex literals register
  `<regex>` and `/re/.test(s)` lowers to `std::regex_search` (the old form
  called a nonexistent `.test` member); discriminated unions (`std::variant`,
  C++17) fail loudly on C++14 embedded targets instead of shipping a header
  the toolchain rejects — and the long-dead `<variant>` include registration
  (unreachable after a `return`) is now live; `parseInt`/`parseFloat`/number-
  parsing `Number()` register `<cstdlib>`.
- **Round 4 (transport audit).** Runtime buffers handed to I2C ops are now
  type-aware: `resp.write(number[])`/`i2c.write(number[])` with a
  `std::vector` argument size with `.size()`/`.data()` — the old path used
  C `sizeof`, which on a vector is the container object's own size
  (garbage-length heap read/OOB write). C-array buffers keep the `sizeof`
  path. Found while auditing the Mod-EC port's transport: the response
  staging now uses a fixed `Uint8Array` (a C array — no heap allocation in
  interrupt context) handed over with ONE whole-buffer write (the per-byte
  loop it replaced left only the last byte in the response buffer), and the
  port's live I2C re-address (the original firmware's TASK_I2C) is
  implemented through `rawCpp` — unregister, rewrite the responder config's
  address, re-register.
- **Round 5 (control flow, characters, and dictionary annotations).**
  String comparisons no longer compare ADDRESSES: `const char*` equality
  (`s1 === s2`) and relational (`s1 < s2`) lower to `strcmp`, as does
  `switch` on a string parameter (the wrap heuristic missed exactly the
  const-char* case). `s[0] === "a"` compares the char against a char
  literal (it emitted `strcmp(char, const char*)`), `s[0] === "ab"` folds
  to `false` (a char is never a 2-char string), and `s[0] + "x"` formats
  the character with `%c` (the old path printed its code point, "97x").
  `v.toString(16)` lowers to a new `__tc_num_radix` helper (it emitted
  verbatim); no-arg `toString()` keeps fractional precision. for-of over a
  string lowers to an index loop (a range-for over `const char*` does not
  compile). An index-signature annotation (`{ [k: string]: number }`)
  resolves to `std::map` (it synthesized an empty struct, so every
  `m["key"]` failed). `===` on interface-typed values fails loudly (structs
  have no identity — compare fields or use a class); class-instance `===`
  keeps correct pointer-identity semantics.
- **Honest failures instead of broken C++.** A HAL factory used directly
  in an expression, an i2c responder whose address is a runtime
  expression, and a member method passed as an interrupt/responder
  handler each fail the transpile with an actionable diagnostic instead
  of silently emitting unbindable C function pointers or raw TS text.
- **Contract boardgen carries the gated hardware surface.** The narrowed
  contract board.ts re-exports the gated classes the framework's board
  module resolved (I2CTarget/I2CResponder on a wired bus, Store/File on a
  storage region, ...) — previously a contract board could not even name
  its own peripherals' classes. Storage facts come from the soc's dtsi
  family (smallest declared module size) or, when the project names a
  build target, from that board's catalog record — so the overlay never
  synthesizes a second `storage_partition` against a board that ships
  one (a dtc duplicate-label error).

Verified end-to-end by re-transpiling and west-compiling the Mod-EC port
for esp32s3_devkitc: all ten generated TUs compile and link to
zephyr.elf.
- **Round 6 (transpile→compile→run audit matrix).** A 131-case matrix that
  transpiles, g++-compiles, RUNS the emitted program and diffs stdout against
  real JS semantics (plus a Zephyr shape-classification pass) surfaced — and
  this round fixes — the following, each pinned by a Round 6 test:
  - **Math include scan**: `Math.exp`/`Math.log` emitted `std::exp`/`std::log`
    with no `<cmath>` (missing from `MATH_PATTERN`); real `%` lowered to a
    bare unprefixed `fmod(` (invisible to the scan) — now `std::fmod` with an
    unconditional `%`→math-header flag; `**` emits qualified `std::pow`.
  - **JS operator semantics**: `a || b`/`a && b` in VALUE position collapsed
    to C++ bools (`0 || 5` → `true`). They now lower to the short-circuit
    ternary `(a) ? (a) : (b)` — operand semantics without losing
    short-circuit; condition positions (`if`/`while`/`for`/`do`/`!`/ternary
    conditions) keep the C++ operators verbatim. Literal `/` promotes to
    real division (`7 / 2` truncated to 3) via
    `promoteDivisionToDouble()` on the generic strategy.
  - **Silent truncation**: `Number("3.5")`/`parseFloat("1.5")` declared
    `const int a = atof(...)` — value corrupted at compile time; the
    conversion globals now infer `double` (`parseInt` → `int`), and
    `Number(string)` registers the `<cstdlib>` its `atof` needs.
  - **Object.prototype lookup trap**: the array-method lookup tables were
    plain objects, so `n.toString(16)` resolved `VECTOR_CALLBACK_METHOD_
    HELPERS["toString"]` to the INHERITED Function — a method-call IR node
    with a function callee crashed the analysis pass
    (`expr.callee.includes is not a function`). Tables are now
    prototype-free, and the analysis skips a non-string callee defensively.
  - **Generic (fallback) strategy ships its runtime surface**: it returned no
    shim and no polyfills, so on `target: "generic"` every string/array
    method called undefined `__tc_*` helpers, `??` referenced an undefined
    `cuttlefish_nullish`, and array literals promoted to a `__tc_StaticArray`
    that was never defined. The hosted core shim + polyfill table are
    extracted to `frameworks/native/hosted-shim.ts` and shared by both
    strategies; the generic target stops promoting to StaticArray (vectors
    are its array form) and promotes division like native.
  - **String-method receivers**: the prescan marks any `.indexOf`/`.includes`
    receiver a mutable array (syntactic), which poisoned STRING variables —
    `s.toUpperCase()` after an `s.indexOf(...)` stayed verbatim, and
    `s.includes(...)` on a param never lowered (params had no scope type).
    The gate now lets a resolved string-like type win over the array
    presumption, string LITERALS resolve, and `indexOf`/`includes` lower
    through the overload-based helpers (string and vector receivers both
    resolve). `"hello".substring(1, 3)` and `.slice(-2)` work.
  - **Containers/exceptions/rest**: `for (const [k, v] of map)` types the
    loop var `std::pair<const K, V>` and extracts via `std::get<N>` (the
    emit-side renderer gained `tuple-access`); rest-param calls collect
    plain args into the declared `std::vector<Elem>{...}` (spread calls
    still pass the vector directly); `catch (e)` with the body referencing
    `e` emits the rethrow-and-cast binding and `(e as Error).message`
    lowers to `.what()`; the string_methods polyfill block declares the
    `<vector>` its split/slice helpers need.
  - **Map iteration gate**: the `Map.keys()/values()/entries()` unsupported
    diagnostic fired on EVERY target — including hosted ones that ship the
    `__tc_map*` helpers, breaking the demo-15 lowerings. It now fires only on
    no-STL targets; hosted targets lower to the helpers.
