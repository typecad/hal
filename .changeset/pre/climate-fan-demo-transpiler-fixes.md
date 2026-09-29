---
'@typecad/cuttlefish': patch
'@typecad/framework-zephyr': patch
---

Eleven transpiler fixes surfaced by the new `zephyr-climate-fan` demo (a
two-module STM32 bench exercising enums, interfaces, inheritance, statics,
getters, cross-file imports, and the settings store):

- Cross-file imports written in the ESM style (`'./control.js'`) fell through
  local-header resolution to the PascalCase fallback and emitted
  `#include <Control.h>` — a header that doesn't exist and the wrong case on
  case-sensitive filesystems. The `.js`/`.mjs` suffix is now stripped before
  candidate generation, emitting `#include "control.h"`.
- TypeScript default parameter values were silently dropped from emitted
  class constructors and methods, so call sites relying on them
  (`Pid.bench()` → 3 args) failed to compile against the 4-parameter
  constructor. Class-body declarations now carry `param = default`.
- Getter access on a class instance (`pid.integral`) lowered to a field read
  of the PRIVATE backing member instead of the accessor call — a compile
  error, and wrong where the getter computes. Getters now lower to
  `pid->getIntegral()` everywhere (own, inherited through `extends`, static
  `Cls::getProp()`, and `this->getProp()` inside class bodies), and the
  snprintf specifier ladder resolves the accessor's return type.
- A free-function call inside a template literal (`${modeLabel(mode)}`) fell
  to the `%d` default even when the function returns `const char*` — printing
  a pointer value on device. Annotated top-level function returns are now
  pre-scanned across the graph (plus the file's own) into a registry the
  IR-time specifier ladder consults; static field reads (`Pid::constructed`)
  and `%g`-formatted identifier args got the same treatment
  (`static_cast<double>` guards keep varargs calls type-correct).
- A `let mode: FanMode = settings.getInt(...)` declaration lost its enum
  annotation to `auto`, making every `mode == FanMode::Off` comparison and
  enum-parameter call ill-formed C++ (scoped enums have no implicit int
  conversion). The declared type is preserved, the read is cast
  `static_cast<FanMode>(...)`, and enum-typed identifiers passed to
  `number`-annotated HAL parameters (`setInt`) cast down with
  `static_cast<int32_t>`.
- ISR-shared globals marked `volatile` on their definition conflicted with
  the plain `bool x;` extern in the split-mode header; the extern now carries
  the qualifier.
- Static data-member definitions (`double Pid::constructed = 0;`) were baked
  into the class header, defining the symbol in every including TU and
  failing the link with multiple-definition. Split mode now keeps exactly one
  definition, in the class's own module .cpp.
- An enum MEMBER argument to a number-annotated HAL parameter rendered as
  `FanMode::Boost` with no cast — the raw shim parameter is `int32_t` and a
  scoped enum has no implicit conversion. The enum→int cast that already
  handled identifiers now also fires for enum member accesses.
- Store `get_*` defaults that were not plain integer literals were silently
  REPLACED BY 0: `resolveNumericArg` returned null for any non-numeric text
  (enum members, variables, call expressions — and for float literals, whose
  C++ render `1.5f` failed `Number()`), and the op builder's `?? 0` filled
  the hole. `settings.getInt('mode', FanMode.Auto)` booted in Off (0)
  instead of Auto (1); `getFloat('f', 1.5)` carried 0. Defaults now fold
  when numeric and otherwise ride the op as C++ expression text.
- Store bool ops folded their argument with `value === "true"`:
  `setBool('f', flag)` wrote false for EVERY variable, and a runtime default
  in `getBool` collapsed to false the same way. Literal true/false still
  fold; expressions pass through verbatim (`boolean | string` op fields,
  the lowering renders string fields as-is instead of truthiness-coercing).
- Store string ops `quoteNonIdentifier`'d the resolved argument, baking a
  `getString('n', fallbackName())` call into the LITERAL "fallbackName()".
  Values/defaults emit the resolver's C++ text verbatim (ns/key still
  literalize — they name settings paths).
- A negative float literal (`const ALARM_FLOOR_C = -5.0`) is a prefix-unary
  over the number, which the declaration type inference didn't handle: it
  inferred `auto` where the positive sibling inferred `double`, and
  split-mode skips auto-typed globals, so the constant also vanished from
  the header's extern list. Prefix-unary now infers from its operand.
- The `__tc_*` string-method polyfills returned pointers into a TWO-slot
  rotating static buffer, but a printf argument list is fully evaluated
  before the call: the demo's status line carries FOUR `__tc_toFixed`
  calls, so calls 3/4 overwrote calls 1/2 and the line printed the setpoint
  value for the temperature. The ring is now `CUTTLEFISH_STR_SLOTS` (8,
  power-of-two mask advance) slots deep.
