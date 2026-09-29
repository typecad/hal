---
'@typecad/cuttlefish': patch
'@typecad/framework-zephyr': patch
---

Sixteen transpiler fixes surfaced by the new `zephyr-bench-supervisor` demo
(a two-module STM32 bench exercising Map/Record lowering, cross-module
interface polymorphism, enum↔number boundaries, byte-wise UART parsing, and
string formatting):

- `map.get(k) ?? d` lowered to `cuttlefish_nullish(m.at(k), d)` — `.at()`
  throws on a miss and the nullish helper evaluates both arguments, so the
  fallback could never fire. It now lowers to the count-guarded
  `(m.count(k) != 0 ? m.at(k) : d)` (the type-checker gate that rejected the
  shape is relaxed to match), the `??` declaration typing prefers the map's
  value type, and enum keys (bare identifiers, enum members, and enum-typed
  instance fields like `cmd.verb`) cast to the map's key type — including
  the double keys `Map<number, V>` produces.
- Interfaces are pointer-typed everywhere (params, fields, containers,
  returns): an interface lowers to an abstract C++ struct, so
  `std::vector<Handler>` could not instantiate it and passing by value
  would slice the virtual dispatch. Cross-module interfaces (imported from
  another file) now register in a pre-scanned name set, so a
  `Map<number, CommandHandler>` declared outside the interface's file
  pointer-izes too — and a class `implements`-ing an imported interface
  attaches the `: public Iface` base (it was silently dropped). Interface
  `===` is now a valid pointer-identity comparison instead of a hard error.
- Enum values crossing into `number`-annotated call parameters cast
  (`static_cast<int>`) — statement and expression calls, free functions
  (param types resolved from the declaration), and class methods (from the
  class registry). A parameter of the SAME enum type takes the value
  directly; the cast is param-type aware.
- `Number.isNaN/isFinite/parseInt/parseFloat` (the static forms) lower like
  the bare globals — they previously emitted verbatim, which is not C++.
  parseInt/parseFloat no longer grow `.c_str()` when fed a `__tc_*` string
  helper's const char* result.
- `x.length = 0` on a vector/StaticArray/string lowers to `x.clear()` (the
  read form's `static_cast<long long>(x.size())` was being assigned to — a
  cast is not an lvalue); a nonzero length assignment now fails loudly.
- `.pop()`/`.push()` on a class-field vector receiver (`this._buf.pop()`)
  lower to `pop_back`/`push_back` — the array-method path only recognized
  identifier receivers. Identifier receivers keep the StaticArray
  promotion prediction.
- JS bitwise expressions (`| 0`, `& mask`) type `int`, and real-typed array
  indexes cast at both element reads and element-assign targets
  (`this->_events[static_cast<int>(i)]`); a real-typed switch discriminant
  reached through element access casts too.
- A getter accessed through a class FIELD (`this._log.size`) lowers to the
  accessor call (`this->_log->getSize()`), matching the instance/static/
  `this.` forms fixed earlier.
- `Record` literals initialize their map field-by-field (`HELP["k"] = v`)
  instead of the ill-formed braced value-only initializer, dot access on a
  Record lowers to element access (any key, even ones named like std::map
  members), and a Record/Map element in a template literal formats by the
  VALUE type (it defaulted to numeric and produced
  `std::to_string(const char*)`).
- A function-typed variable (`const f = (x): string => …`) joins the
  cross-module return-type registry, so `${f(x)}` picks `%s` (it printed a
  pointer through `%d`). `n.toString(16)` in a template also formats `%s`
  (`__tc_num_radix` returns const char*), and the `%.15g` snprintf buffer
  estimate covers the directive's real 22-byte worst case
  (-Wformat-truncation).
- Exported free functions' split-mode header prototypes are hoisted ABOVE
  the classes (inline class bodies in the header call them; the prototype
  used to ride with the .cpp-side definition), and every `__tc_*` string
  polyfill definition is `inline` — a second TU including the block linked
  with multiple-definition errors. The polyfills also gained std::string
  receiver overloads and a `__tc_split` definition (Zephyr had none —
  `.split()` calls linked against nothing), with `startsWith`/`includes`
  routed through the helpers so a std::string receiver compiles; the
  result ring (num_radix included) rotates CUTTLEFISH_STR_SLOTS slots.
- A `const s = ''; s += x` accumulator loop rebinds through a static buffer
  while READING it — `snprintf(buf, "%s…", buf, …)` is UB from the second
  iteration. The target now rides a `std::string` temp copy.
