---
'@typecad/cuttlefish': patch
'@typecad/framework-zephyr': patch
---

Zephyr adopts the ONE string model: std::string end to end, deleting the
const char* + rotating-static-ring implementation and its whole bug class
(follow-up to the structural-consolidation changeset; surfaced by the
climate-fan and bench-supervisor demos):

- **Polyfills return std::string BY VALUE.** Every `__tc_*` string/number
  helper takes `const std::string&` (a const char* literal converts
  implicitly) and returns an owned std::string. The eleven rotating static
  result rings are GONE — the aliasing ceiling ("N live results need N ring
  slots"; the four-toFixed-calls-in-one-printf bug) no longer exists because
  every result owns its storage. Zephyr links with REQUIRES_FULL_LIBCPP,
  and short results ride std::string's SSO, so typical fixed-point
  formatting never touches the heap. Measured on the bench-supervisor demo:
  flash +0.8 KB (string methods), RAM −2.1 KB (rings removed).
- **normalizeCppType keeps std::string** (variables, container elements,
  function returns) instead of remapping to const char*. String comparisons
  lower to native `a == b` / `a < b` (JS reference/content semantics
  directly), `.length` to `.length()`, startsWith to the prefix idiom.
  `.c_str()` appears ONLY at C-varargs boundaries — snprintf argument
  shaping already handled it via needsCStrForStringLike; the IR-time
  snprintf builder and the `atoi`/`atof` shaper now route std::string-
  classified arguments through the same adaptation (registry-driven).
- **HAL string boundary**: a `string`-annotated parameter (`write(data:
  SerialValue)`) lowers to a const char* shim; std::string arguments —
  owned locals, helper results, string container elements, string-returning
  method calls (interpolation-wrapped shapes unwrapped) — take `.c_str()`
  at the call site, the same seam the enum→int casts use. Store
  put_string/get_string values/defaults get the same treatment.
- **Runtime-initialized constants get linkage**: a `charCodeAt`-initialized
  module constant now infers a concrete type (`int`) — prototype-method
  returns classify through the helper-return registry — and split mode
  emits a header `extern const T name;` for it (the prior-extern linkage
  rule, the same mechanism the literal constants already use). Inline class
  bodies in the module's header can read the symbol; the demo's ASCII-code
  constants are `charCodeAt(0)` initializers again (the workaround is
  reverted).
- The `.split()` polyfill definition now takes `const std::string&`
  directly, and the `__tc_str_ptr` receiver wrap is dropped (the helper was
  never defined on Zephyr — a latent gap the model flip removes).

Known sharp edge remaining (documented in the bench-supervisor README): a
top-level variable named like a libc function (`log`) still renames its
declaration but not its references.
