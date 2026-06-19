# Blink + ADC read — cuttlefish demo #34 (Arduino AVR)

The **second AVR demo** and the **first to exercise the TypeCAD HAL end-to-end
on real hardware**. Where demo #33 was pure in-process computation (sensor
statistics), this one reaches the silicon: it configures a digital output (the
on-board LED) and an analog input (A0), then in a steady loop it blinks the
LED, reads A0, and prints the raw count + computed voltage to Serial.

Transpiled to C++ by cuttlefish (`@typecad/framework-arduino`), compiled for
`arduino:avr:uno`, uploaded, and verified live on a connected Uno.

## Running

```bash
npm run lint      # ESLint with the cuttlefish transpiler-rules plugin
npm run compile   # transpile TS -> C++ (.ino) and compile with avr-gcc
npm run upload    # compile + upload to the Uno on COM7 + open serial monitor
```

- **`npm run compile` exits 0.** `avr-gcc` emits **no errors and no warnings**.
  Memory usage on an ATmega328P (Arduino Uno):

  ```
  Flash: 4.2 KB / 31.5 KB (13%)
  RAM:   225 B / 2.0 KB (11%)
  Heap:  1.8 KB available
  ```

- **`npm run upload`** flashes the Uno and streams the serial monitor at 9600
  baud. Captured live output (A0 left floating, so the reading drifts then
  settles as the pin's charge bleeds off):

  ```
  --- blink + ADC demo ---
  led=on  adc=439 mV=2145
  led=off adc=434 mV=2116
  led=on  adc=429 mV=2096
  led=off adc=426 mV=2082
  ...
  led=on  adc=412 mV=2013
  led=off adc=412 mV=2013
  ```

  The on-board LED blinks once per line, `adc` is the live 10-bit count from
  `analogRead(14)`, and `mV = adc * 5000 / 1023` (so `412 → 2013`). These are
  real ADC values — **not** the pin number `14` — which is what confirms the
  Finding-B workaround below is correct on hardware.

## Why the program is shaped the way it is

The HAL lowering and the AVR target together force the structure:

- **All pin I/O is at the top level.** Pins come from
  `@typecad/board-arduino-uno` (`LED`, `A0`) as typed `Pin` instances, and the
  transpiler inlines pin method calls to direct Arduino C++ — but only at the
  top level (which flows into the auto-generated `setup()`). See Finding C for
  why pin calls inside a function do not work.
- **`adc.readAnalog()` is called inline at each point of use, never stored.**
  See Finding B (the most serious finding — a correctness bug).
- **Owned blink state is a module-level scalar (`let ledOn`), not a class.**
  AVR has no heap manager, so `new Blinker()` is rejected (Finding A).
- **The report is built by string concatenation**, with the LED-state ternary
  assigned to a typed `const state: string` first (Finding D).

---

# Transpilation issues found by Demo #34

Demo #34 is the **first HAL-on-hardware demo**. It surfaced four distinct
issues, all reproduced verbatim from `npm run compile`. Three are transpiler
bugs/gaps and one is an inconsistent-safety-gate. They are grouped into two
larger families at the end — the families are where the "large fixes" should
land, not the individual sites.

## Finding A — the `heap-allocation-avr` gate's coverage depends on whether a HAL `import` is present

```
src\main.ts (152,7) error [heap-allocation-avr]: Heap allocation
    (`new Blinker()`) is unsafe on AVR targets. AVR has only 2 KB of SRAM and
    no heap manager; `operator new` will corrupt memory or silently fail.
    Declare the object as a local or global variable instead.
```

A top-level (and, once a HAL import is present, also function-scoped)
`new ClassName()` is rejected by `validateHeapArrayUsage`
(`ir/heap-array-validation.ts`). The rule itself is correct in spirit — AVR has
no heap. The problem is its **coverage is inconsistent**:

- demo #33's `const acc: Accumulator = new Accumulator();` (inside
  `computeStats`) **compiled cleanly** — no diagnostic.
- the same `new Blinker()` (a class with one `boolean` field) is **rejected**
  the moment `import { LED } from '@typecad/board-arduino-uno'` is in the file.

**Root cause (bisected):** the validator pattern-matches `var_decl` whose
initializer is a `raw` IR node matching `/^new\s+\w/`. A user-class `new`
always lowers to a `raw` node (`ir/expression-to-ir.ts:1503`). What flips the
gate on/off is whether the HAL/board `import` is present — that import pulls
the board module's transpiled IR into the program, which restructures the
function bodies such that the validator's walk reaches the `new`. With no
import, the same `new Blinker()` lowers to the same `raw` text but the walk
does not flag it (verified: test6, no import → `Blinker* b = new Blinker()` is
emitted with no diagnostic).

So the gate catches some AVR `new` sites and silently lets identically-shaped
others through, depending on unrelated program structure. Demo #33 passed only
because it had no HAL import; a demo that mixes HAL + classes would have hit
this.

**Demo fix (workaround, not a transpiler fix):** owned state is a module-level
scalar (`let ledOn: boolean`) rather than a `new Blinker()`. This is the
AVR-idiomatic shape the gate's own hint recommends and is what real AVR
firmware does for a single bit of owned state.

**Large fix (Family I):** the gate should detect heap allocation **semantically**
(any `var_decl`/expression whose initializer constructs a class instance,
regardless of whether it lowered to a `raw` node and regardless of import
structure), not by pattern-matching `raw` text. See **Family I** below.

## Finding B — storing the return value of a pin method call MISCOMPILES (correctness bug)

```
const raw: int32_t = adc.readAnalog();
console.log('' + raw);            // source
```
emits
```cpp
pinMode(14, INPUT);
snprintf(__cuttlefish_str_1, ..., "%d", 14);   // BUG: literal 14, not the read
Serial.println(__cuttlefish_str_1);
```

The `const raw = adc.readAnalog()` **declaration vanishes** — no
`analogRead(14)` call is emitted at all — and **every later reference to `raw`
is replaced with the pin's number `14`**. Verified across variable names
(`raw`, `v`, `measurement`) and across `const`/`let`: it is not name- or
storage-class-specific. With a reassignment the bug is even starker:

```ts
let v: int32_t = adc.readAnalog();
v = v + 1;
console.log('' + v);
```
emits
```cpp
auto v = analogRead(14);          // correct: runtime read
v = 14 + 1;                       // BUG: `v + 1` -> `14 + 1`
snprintf(..., "%d", 14);          // BUG: `v` -> `14`
```

So the declaration keeps the real call, but every **subsequent use** of a
variable that was assigned from a pin method is clobbered to the pin's number.
On hardware this would print `14` forever instead of the ADC reading.

This is the same root cause the test file already flags as known-but-skipped:
`hal-pin-config.test.ts` notes *"pin variables are substituted by their
numeric pin value, so `led.pwm(50)` lowers to `9.pwm(50)`"* and `.skip`s the
PWM tests on exactly those grounds. And `hal-adc.test.ts:50-58` **asserts**
`Serial.println(14)` (the pin number, not the voltage variable) as the expected
output — i.e. the test encodes the buggy behavior as correct.

**Root cause (generalizable):** the HAL pin-resolution pass substitutes the
resolved pin number for the pin variable at use sites. It treats
`const x = pin.method()` as "`x` is an alias for the pin" and substitutes the
pin number for `x` — but `x` holds the method's **return value**, not the pin.
There is no distinction between "this variable *is* a pin" and "this variable
holds the *result* of a pin operation."

**Demo fix (workaround):** call `adc.readAnalog()` **inline at each point of
use** (never store it). The emitted code is then correct:
```cpp
const Reading reading = { analogRead(14), toMillivolts(analogRead(14)) };
```
This does two ADC conversions per blink (once for the raw count, once for the
millivolt conversion). Harmless for a demo; the cost is documented in the
source header.

**Large fix (Family II):** pin-variable substitution must only fire for
variables whose value **is** a pin (the `Pin`/`InputPin`/`OutputPin` identity
returned by `asOutput`/`asInput`/`fromPort`), never for variables that merely
hold the **return value** of a method called on a pin. The discriminator is the
assignment RHS shape (`x = pin` vs `x = pin.method(...)`), which the pass can
see. This one fix would also un-`.skip` the PWM tests and fix the
`hal-adc.test.ts:50-58` assertion (which currently encodes the bug). See
**Family II** below.

## Finding C — pin method calls inside a function are not inlined (`'led' was not declared in this scope`)

```
src\main.ts (96,5) error [call]: 'led' was not declared in this scope
        led.high();
src\main.ts (98,5) error [call]: 'led' was not declared in this scope
        led.low();
```

A pin configured at the top level (`const led = LED.asOutput()`) has its
**declaration** inlined to `pinMode(13, OUTPUT)` inside `setup()` — the `led`
variable is compile-time-substituted away at the declaration site. But a
**method call on that pin from inside a function** (`toggleLed` calling
`led.high()`) is emitted verbatim as `led.high()`, referencing a `led` variable
that no longer exists. (At the top level the same call inlines correctly:
`led.high()` → `digitalWrite(13, HIGH)`.)

**Root cause (generalizable):** HAL inlining is **scope-local** — it only fires
where the pin variable is in the same (top-level → setup) scope as its
configuration. A function that references a top-level pin const does not see
the inlining; the call is rendered against the (now-substituted-away)
identifier.

**Demo fix (workaround):** all pin I/O is at the top level (inside the
`while (true)` loop). The pure helpers (`toMillivolts`, `formatState`,
`report`) contain no pin calls.

**Large fix (Family II):** this is the other face of the pin-resolution pass
(Finding B's family). If pin variables were resolved consistently — substituting
the pin number at **every** use site regardless of scope, OR keeping the
variable live and rewriting `pin.method()` → `digitalWrite(num, ...)` at every
call site — then both Finding B (don't substitute for return-value variables)
and Finding C (do substitute consistently across scopes) fall out of one
resolution model. See **Family II** below.

## Finding D — inline ternary of two string literals as a `+` operand emits an invalid `.c_str()`

```
src\main.ts (126,3) error [assign]: request for member 'c_str' in
    '(ledOn ? "on " : "off")', which is of non-class type 'const char [4]'
      line = line + 'led=' + (ledOn ? 'on ' : 'off');
```

Reproduced in isolation (no HAL, no AVR-specific anything):
```ts
let line: string = '';
line = line + 'led=' + (ledOn ? 'on ' : 'off');
```
The string-concat lowering wraps the ternary operand in `.c_str()`, as if it
were a `std::string`. But a ternary whose two branches are string literals has
common type `const char*` (no `.c_str()` member), so avr-g++ rejects it.

**Root cause (generalizable):** the snprintf/concat operand-type inference
classifies a parenthesized conditional expression as "string-typed, needs
`.c_str()`" without checking that its common type is already a `const char*`
(the case that must NOT be wrapped). It is specifically the **inline** ternary
as a direct `+` operand; assigning the ternary to a typed `const s: string`
first resolves the type correctly.

**Demo fix (workaround):** `formatState` assigns the ternary to a typed
`const state: string` before concatenation.

**Large fix:** the concat operand-type resolver must treat a `cond ? "lit" :
"lit"` operand as `const char*` (no `.c_str()`) rather than `std::string`. The
discriminator already exists for plain string-literal operands; the conditional
case just isn't routed through it.

---

# The two larger families (where the large fixes land)

The user asked to categorize the findings into larger families so fixes are
structural, not point-for-point. The four findings collapse into two families:

## Family I — diagnostics that detect a pattern by string-matching `raw` IR text, not semantically

**Members:** Finding A (`heap-allocation-avr`).

**The shared defect:** a validator pattern-matches the **textual form** of a
lowered `raw` IR node (`/^new\s+\w/`) instead of recognizing the **construct**
("a class is being heap-allocated"). Because whether a construct lowers to a
`raw` node depends on unrelated upstream IR structure (here: whether a HAL
`import` is present), the same source pattern is caught in some programs and
silently allowed in others.

**The single large fix:** make every such validator key off the **source
construct** (an AST `NewExpression` whose class is a user type, on a
heap-unsafe architecture), independent of how that construct later lowers.
Concretely for Finding A: walk `NewExpression` nodes (or tag var_decls with a
structured `new-class` IR kind instead of `raw` text) and gate on
`strategy.isHeapAllocationUnsafe(arch)`. Then demo #33's `new Accumulator()`
and a HAL demo's `new Blinker()` are treated identically — both correctly
rejected on AVR (or both correctly allowed if the heap rule is relaxed), with
no dependence on import structure.

This same structural principle (detect the construct, not the lowered text)
prevents the whole class of "the gate fires depending on what else is in the
file" bugs.

## Family II — the HAL pin-resolution pass conflates "a variable that IS a pin" with "a variable that HOLDS a pin operation's result"

**Members:** Finding B (correctness — stored return value clobbered to pin
number) and Finding C (`'led' not in scope` — method call on a pin from a
function isn't inlined).

**The shared defect:** the pass substitutes the resolved pin number for a
variable name at use sites, with no model of whether the variable's **value**
is the pin itself or merely the **result** of calling a method on a pin. It
also only performs this substitution in the scope where the pin was declared,
so the same pin variable is resolved in one scope and unresolved in another.

The two findings are opposite symptoms of one missing distinction:

- Finding B: the pass substitutes the pin number for a variable that holds a
  **return value** (`x = pin.readAnalog()` → `x` wrongly becomes `14`),
  *over*-substituting.
- Finding C: the pass fails to substitute (or inline) for a pin variable
  referenced in a **different scope** than its declaration
  (`led.high()` inside a function → `led` is unresolved), *under*-substituting.

**The single large fix:** give the pin-resolution pass a real model of pin
identity vs. pin-derived values, applied uniformly across all scopes:

1. Track which variables hold a **pin identity** (the `Pin`/`InputPin`/
   `OutputPin` returned by `asOutput`/`asInput`/`fromPort`/`Pin(n)`). For
   those, substitute the pin number (or inline `pin.method()` → the Arduino
   call) at **every** use site, in every scope — fixing Finding C.
2. Do **not** substitute for variables whose initializer is a **method call**
   on a pin (`x = pin.method(...)`) — those hold the return value, not the pin.
   That fixes Finding B.
3. As a consequence, the `.skip`'d PWM tests un-skip, and the
   `hal-adc.test.ts:50-58` assertion (which currently encodes the bug by
   expecting `Serial.println(14)`) must be corrected to expect the actual
   voltage variable.

One resolution model, two bugs fixed, and the HAL tests stop encoding the bug
as correct.

---

## What this demo intentionally does NOT cover

To keep the program mid-complexity and focused on the HAL, demo #34 does
**not** exercise:

- PWM output (`led.pwm(n)`) — blocked by Family II (the `.skip`'d PWM tests);
  a future demo can stress it once the pin-resolution pass is fixed.
- `Map`/`Set` (AVR has no `<map>`/`<set>` — same family as demo #33 Finding E).
- interrupts / `onFalling` (the `.skip`'d ISR-extraction tests track a separate
  gap there).
- `extends`/`super`, `try`/`catch`, async — out of scope for a HAL demo.

Each of those is its own future demo.
