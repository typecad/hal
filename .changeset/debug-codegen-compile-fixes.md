---
"@typecad/cuttlefish": patch
"@typecad/framework-esp32": patch
---

## Fix: ESP-IDF debug codegen compile errors (format specifiers + use-before-declaration)

`cuttlefish build --debug` on an ESP-IDF target failed to compile under
`-Werror` whenever a breakpoint was set. Two root causes, both fixed:

### 1. Wrong printf format specifiers
The ESP32 debug codegen emitted `printf("... %g\n", var)` for every variable,
but `%g` requires `double`. Variables inferred as `int`/`bool`/`long`/`string`
tripped `-Werror=format=`. (Arduino's path was unaffected — `Serial.println(x)`
is type-agnostic via overload resolution.)

The debug preprocessor now infers a coarse C++ type category per variable from
AST shape (explicit `: T` annotation first, then initializer shape — `true`/
`false`→bool, integer literal→int, `millis()`/`micros()`→long, string literal
→string), with `unknown` as the fallback. The ESP32 codegen picks the matching
specifier (`%d`, `%ld`, `%g`, `%s`) and casts to `(double)` for unknowns so the
generated printf always compiles.

### 2. Use-before-declaration on the declaring line
A breakpoint on `const now = millis();` injected the variable dump BEFORE
`now`'s declaration → `'now' was not declared in this scope`. The scope
analyzer returned ALL function-body locals for every line in the body,
ignoring where each local was declared.

It now tracks each local's declaration line and includes a body local only on
lines STRICTLY after its declaration (`declLine < line`), since the dump is
injected at the start of the breakpoint line before that line runs. Params and
module-scope vars remain in scope from the function's first line. This fixes
both the compile error and a latent runtime bug (reading an uninitialized local
at a breakpoint above its declaration).

### Note
A breakpoint on a variable's own declaring line no longer dumps that variable
(it isn't in scope yet at the injection point). To inspect a just-declared
value, set the breakpoint on the following line. This is documented in the
scope analyzer.
