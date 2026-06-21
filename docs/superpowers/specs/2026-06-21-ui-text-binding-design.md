# TypeHAL UI — Text Binding Fix (Dynamic Text) — Design Spec

**Date:** 2026-06-21
**Status:** Draft (pending user review)
**Approach:** Per-node mutable text buffer + fill-style `textFn` + `strcmp` change detection + `snprintf` lowering of `String(<numeric>)`.

---

## 1. Intent

Make `ui.bind(node, 'text', fn)` actually work. Today, color bindings update the
screen every tick, but text bindings are broken at three levels and are
consequently unused — the demo (`demo-ui/src/main.ts`) only binds the counter's
*color*, never its *text*. This spec fixes dynamic text so the counter can read
"0" → "1" → "2" on each press, and so authors can write text bindings generally.

The fix is purely in the cuttlefish lowering/runtime layer; no new device-side
allocation strategy, no new display HAL ops, no new authoring surface.

## 2. Problem — three-level diagnosis (verified against the code)

**Level 1 — `String()` has no lowering in the binding context.**
`resolveBindCall` (`packages/cuttlefish/src/ir/transformers/ui-call-resolver.ts`,
the `fnArg` handling around lines 342–357) runs the arrow body blindly through
`renderExprAsText(expressionToIR(...))`. `renderExprAsText`
(`packages/cuttlefish/src/ir/render-expr.ts`) has no rule for `String(...)`, so
`String(count())` emits a bare `String(count)` constructor call that does not
exist in bare-metal C++. (Note: `String()` *is* handled by the host
`expression-renderer.ts` path, but the UI binding seam bypasses that renderer.)

**Level 2 — no mutable text buffer in the C++ runtime.**
`UINode.text` (`runtime-header.ts:31`) is `const char*` — a pointer to a flash
literal baked into the node-table initializer. It cannot hold dynamically
computed text (e.g. `snprintf` output) at runtime.

**Level 3 — pointer-identity comparison never detects changes.**
The binding dispatch (`runtime-header.ts:174–176`) compares
`newText != __ui_nodes[...].text` by pointer identity. A text function returning
a pointer to a buffer compares wrong in both directions and cannot reliably
detect "the content changed."

## 3. Confirmed decisions

Resolved during brainstorming; each is load-bearing for the design:

1. **Named constant `UI_TEXT_BUF = 16`.** Single source of truth used in the
   `UINode` struct field, the `textFn` call-site size argument, and the emitted
   `snprintf` size argument. Fits a 32-bit `int` (`-2147483648`, 11 chars) plus
   NUL plus slack. 16 is a deliberate choice over 12 (too tight for any future
   `float`/short composition) and over 32 (doubles SRAM cost per text node).
2. **Node-owned buffer + fill-style `textFn`.** Each `UINode` carries its own
   `char textBuffer[UI_TEXT_BUF]`. `textFn` signature changes from
   `const char* textFn(void)` to `void textFn(char* buf, uint8_t size)` — it
   writes directly into the node's buffer. No per-tick allocation, no dangling
   pointers.
3. **`strcmp` change detection.** The dispatch saves the current buffer, calls
   `textFn` to refill it, and `strcmp`s to decide whether to mark dirty.
4. **`snprintf` for numeric→string conversion.** Standard C++, consistent with
   the existing template-literal lowering convention (CLAUDE.md: "Template
   literals lower to stack `char` buffers + `snprintf`"). Available on AVR
   newlib, ESP32, and the native test framework. `itoa` (smaller but
   non-standard) was rejected.
5. **Scope: three arrow-body shapes in v1.** `String(<numeric>)`, bare string
   literal, and template literal with numeric interpolations. String
   *concatenation* (`"a" + String(b)`) is explicitly out of v1. Unknown shapes
   emit a warning diagnostic + a safe no-op body rather than broken C++.

## 4. Architecture

### 4.1 The `UINode` buffer model

The `UINode` struct gains a mutable buffer and a flag. The existing `text`
field is **never mutated after init** — it keeps pointing at the flash literal
forever and serves as the immutable baseline. `textBuffer` is the mutable slot
and is the only thing runtime code writes.

```cpp
#define UI_TEXT_BUF 16  // single source of truth

struct UINode {
  // ... existing fields unchanged ...
  const char* text;             // immutable flash literal (never mutated at runtime)
  char textBuffer[UI_TEXT_BUF]; // dynamic text — only read when hasTextBinding == 1
  uint8_t hasTextBinding;       // set by ui_init when a PROP_TEXT binding targets this node
  // ...
};
```

Invariant: `text` and `textBuffer` never alias. A node either displays its flash
literal (`hasTextBinding == 0`, draw reads `text`) or its buffer
(`hasTextBinding == 1`, draw reads `textBuffer`).

### 4.2 The `UIBinding` textFn signature

```cpp
// was: const char* (*textFn)(void);
void (*textFn)(char* buf, uint8_t size);
```

The binding function writes into the caller-provided buffer. The size argument
always equals `UI_TEXT_BUF`; it is passed explicitly so the lowered `snprintf`
calls have a real bound rather than a captured constant.

### 4.3 Seeding in `ui_init`

Seeding happens in `ui_init`, not in the static node-table emitter. This keeps
two lowering phases decoupled: the node table is built from the styled tree
(HTML/CSS), the binding table is built from `ui.bind(...)` calls. They meet only
at runtime in `ui_init`:

```cpp
static inline void ui_init(void) {
  for (uint8_t i = 0; i < __ui_node_count; i++) __ui_nodes[i].dirty = 1;
  // Seed each text-bound node's buffer from its flash literal so the first
  // strcmp in ui_tick has a valid baseline (no spurious redraw on frame 1).
  for (uint8_t i = 0; i < __ui_binding_count; i++) {
    if (__ui_bindings[i].prop == PROP_TEXT && __ui_bindings[i].textFn) {
      uint8_t n = __ui_bindings[i].node;
      __ui_nodes[n].hasTextBinding = 1;
      strncpy(__ui_nodes[n].textBuffer, __ui_nodes[n].text, UI_TEXT_BUF - 1);
      __ui_nodes[n].textBuffer[UI_TEXT_BUF - 1] = '\0';
    }
  }
}
```

### 4.4 Binding dispatch in `ui_tick` — save/compare

```cpp
if (__ui_bindings[i].prop == PROP_TEXT && __ui_bindings[i].textFn) {
  char oldBuf[UI_TEXT_BUF];
  strcpy(oldBuf, __ui_nodes[node].textBuffer);                       // save
  __ui_bindings[i].textFn(__ui_nodes[node].textBuffer, UI_TEXT_BUF); // refill
  if (strcmp(oldBuf, __ui_nodes[node].textBuffer) != 0) {
    ui_mark_dirty(node);                                             // content changed
  }
}
```

A stack-local `oldBuf[16]` per text binding per tick is cheap and correct. It
avoids a second persistent buffer per node.

### 4.5 Draw dispatch — source selection

One local at the top of the dirty-node loop replaces the three current
`node.text` reads (`runtime-header.ts` lines 208, 226, 255):

```cpp
const char* displayText = __ui_nodes[i].hasTextBinding
  ? __ui_nodes[i].textBuffer
  : __ui_nodes[i].text;
```

`displayText` is used for text-width measurement, `setCursor`/`print`, and
underline width. All three call sites switch to it.

### 4.6 SRAM cost

Every node carries `textBuffer[16] + hasTextBinding` regardless of binding
status — the struct is uniform. For a 16-node UI that is ~272 B extra vs. today.
Acceptable on ESP32 (320 KB SRAM). On AVR Uno (2 KB SRAM) it is ~13% of SRAM
for a UI that has already committed to a frame buffer; within budget for v1.
A PROGMEM-compact representation is a future optimization, not v1 scope.

## 5. The `String()` lowering (Level 1 fix)

### 5.1 Where the logic lives

A new helper `lowerTextBindingBody(body, diagnostics)` in `ui-call-resolver.ts`.
It is called from `resolveBindCall` *before* the generic
`renderExprAsText(expressionToIR(...))` path, and only when
`property === "text"`. It is a pure function of the arrow-body AST, callable
and testable in isolation.

### 5.2 The three shapes

| Author writes | Detected as | Emitted C++ body |
|---|---|---|
| `() => String(count())` | `CallExpression`, callee is `String` identifier, 1 arg | `snprintf(buf, size, "%d", count);` |
| `() => "idle"` | bare `StringLiteral` | `snprintf(buf, size, "%s", "idle");` |
| `` () => `count: ${n()}`  `` | `TemplateLiteral` with numeric interpolations | `snprintf(buf, size, "count: %d", n);` |

Each lowers to a single `snprintf` statement. `buf` and `size` are the
function parameters; they are not synthesized per shape.

### 5.3 Type-aware format specifier

The lowerer decides the `%` specifier for each numeric interpolation by this
rule, applied per interpolated expression:

1. If the expression is a bare signal read — `name()` where `name` is in the
   `signals` map — look up `signals.get(name).cppType`:
   - `int`/`uint*`/`bool` → `"%d"`
   - `float`/`double` → `"%g"` (matches JS `Number.toString()` dropping trailing
     zeros, e.g. `3.0` → `"3"`)
2. Otherwise (non-signal expression: `count() + 1`, a numeric literal,
   arithmetic) → default `"%d"`. Arbitrary arithmetic on ints is int; if an
   author binds a non-signal float expression in v1 it formats with `%d` and
   truncates — acceptable for v1, surfaces via the unlowered warning only if
   the whole shape is unrecognized.

This is the one piece of type-awareness the lowerer needs. The signal's cpp
type comes from the `signals` map populated by `recordSignal` in
`ui-call-resolver.ts`.

### 5.4 The emitted binding function

```cpp
// was: const char* __ui_bind_text_0(void) { return <broken>; }
void __ui_bind_text_0(char* buf, uint8_t size) { snprintf(buf, size, "%d", count); }
```

### 5.5 Unknown shapes — fail loudly

Anything not matching the three shapes does **not** fall through to the
generic renderer (which would emit broken `String(...)`). Instead it produces:

- A warning diagnostic with code `ui-bind-text-unlowered` so the author sees it.
- A safe no-op body: `buf[0] = 0;` (integer zero assignment — the null
  terminator). The node displays an empty string, never broken C++.

This is a deliberate change from the current silent-broken behavior. The
fallback body is written `buf[0] = 0;` rather than `buf[0] = '\0';` purely to
avoid backslash-escaping ambiguity between the spec's prose form and the
TS-string literal that must appear in source; the two are semantically
identical.

### 5.6 The `BindingSpec` carries an imperative body, not an expression

`BindingSpec` gains an optional `cppBody?: string` (the imperative statement
body for text bindings). Existing `cppExpr` continues to carry the expression
for color bindings, unchanged. The emitter selects `cppBody` for text
bindings, `cppExpr` for color bindings.

### 5.7 `snprintf` include

The binding-function bodies use `snprintf`, so the emitter must ensure
`<stdio.h>` is in `ctx.includes` (mirroring how it already pushes `<SPI.h>`).
Push it if absent.

## 6. File-by-file changes

Listed in dependency order.

1. **`packages/cuttlefish/src/ui/runtime-header.ts`**
   - Add `#define UI_TEXT_BUF 16` above the struct.
   - `UINode`: add `.textBuffer[UI_TEXT_BUF]` + `.hasTextBinding` after `.text`.
   - `UIBinding`: change `textFn` to `void (*textFn)(char* buf, uint8_t size)`.
   - `ui_init`: add the seeding loop (§4.3).
   - `ui_tick` text-binding dispatch (lines 172–178): replace pointer compare
     with save/compare/`strcmp` (§4.4).
   - Draw dispatch: add `displayText` local; switch the three `node.text` reads
     (lines 208, 226, 255) (§4.5).

2. **`packages/cuttlefish/src/ir/transformers/ui-reactive.ts`**
   - `BindingSpec`: add `cppBody?: string`.
   - `emitBindingEntry`: text bindings still wire `.textFn=<name>`; update the
     inline comment to note the new `void` signature.

3. **`packages/cuttlefish/src/ir/transformers/ui-call-resolver.ts`**
   - `resolveBindCall`: when `property === "text"`, branch to
     `lowerTextBindingBody(fnArg.body, diagnostics)` before the generic path.
     Record `cppBody` into the `BindingSpec` (not `cppExpr`).
   - New exported helper `lowerTextBindingBody(body, diagnostics)`: pure
     function of the arrow-body AST. Returns `{ cppBody, format }` for the
     three shapes, or `{ cppBody: "buf[0] = 0;" }` + a
     `ui-bind-text-unlowered` warning for anything else.

4. **`packages/cuttlefish/src/emit/emitters/ui-emitter.ts`**
   - Binding-function emission (lines 66–72): text bindings emit
     `void ${fnName}(char* buf, uint8_t size) { ${spec.cppBody} }`.
   - Ensure `<stdio.h>` in `ctx.includes` (push if absent), same pattern as
     `<SPI.h>`.

5. **`packages/cuttlefish/src/ir/transformers/ui-lowering.ts`**
   - Node-table initializer (line 108): add
     `.textBuffer={0}, .hasTextBinding=0` to the aggregate initializer so
     every node's buffer is zeroed and the flag defaults off. Binding-driven
     nodes get re-seeded in `ui_init`.

6. **`demo-ui/src/main.ts`**
   - Add `ui.bind(screen.counter, 'text', () => String(count()));` so the
     counter's displayed text actually updates. Today the demo only binds the
     counter's *color*; the "0" never changes. This both dogfoods the fix and
     is the clearest correctness signal.

## 7. Testing

Existing tests assert on emitted C++ text (`ui-reactive.test.ts`,
`runtime-header.test.ts`, `ui-e2e.test.ts`). New coverage mirrors that —
concrete substrings, no smoke checks.

### 7.1 Unit tests (assert on emitted strings)

- **`tests/packages/cuttlefish/ui-reactive.test.ts`** — add a case asserting a
  text `BindingSpec` *with* `cppBody` produces a table entry that still wires
  `.textFn=<name>` (guards the table wiring survives the signature change and
  the new field).

- **`tests/packages/cuttlefish/runtime-header.test.ts`** — add cases asserting
  the header contains: `UI_TEXT_BUF`, `textBuffer`, `hasTextBinding`,
  `void (*textFn)(char* buf, uint8_t size)`, a `strcmp(` inside the `ui_tick`
  region, and that `ui_init` seeds `textBuffer` from `text` (`strncpy` +
  `hasTextBinding = 1`).

- **New `tests/packages/cuttlefish/text-binding-lowering.test.ts`** — the core
  of the new coverage. Exercises `lowerTextBindingBody` directly with each of
  the three shapes and asserts on the exact emitted C++ body:
  - `String(count())` → body contains `snprintf(buf, size, "%d", count);`
  - `"idle"` → body contains `snprintf(buf, size, "%s", "idle");`
  - `` `count: ${n()}`  `` → body contains
    `snprintf(buf, size, "count: %d", n);`
  - Unrecognized shape (e.g. `() => [1,2,3]`) → warning diagnostic code
    `ui-bind-text-unlowered` + body equals `buf[0] = 0;`.

### 7.2 E2E test

- **`tests/packages/cuttlefish/ui-e2e.test.ts`** (or a sibling) — add a case
  that mounts a UI with a text binding and asserts the emitted entry-TU
  contains the new `void __ui_bind_text_N(char* buf, uint8_t size) { ... }`
  function and that `<stdio.h>` appears in includes.

### 7.3 Out of scope for tests

No AVR/ESP32 toolchain is in the test matrix. Tests assert on emitted C++ text,
matching the repo convention — they do **not** claim "compiles on ESP32" or
"runs on hardware." This limitation is stated plainly here so it is not
forgotten at implementation time.

## 8. Out of scope (explicitly deferred)

- String concatenation (`"a" + String(b)`).
- `String(float)` precision control beyond `"%g"`.
- PROGMEM compactness / per-node buffer sizing (every node pays the 16 B today).
- Per-property methods on the UI tree (`screen.counter.text(fn)` instead of
  `ui.bind(...)`). This was deferred in the prior UI graphics spec too.
- A hardware-compile CI gate.

## 9. Authoring experience after the fix

```typescript
const count = ui.signal(0);

ui.bind(screen.counter, 'text', () => String(count()));
// emits: void __ui_bind_text_0(char* buf, uint8_t size) {
//          snprintf(buf, size, "%d", count);
//        }

ui.watchPin(4, () => { count.set(count() + 1); });
// on press: count increments → next ui_tick, textFn writes new value into
// node.textBuffer → strcmp detects change → redraws counter
```

The counter text updates from "0" to "1" to "2" on each press.
