# Text Input & On-Screen Keyboard — Design

**Date:** 2026-06-19
**Status:** Approved (pending implementation)
**Scope:** Add `<input>` text entry to the TypeHAL UI library, backed by a modal on-screen keyboard overlay.

---

## 1. Goals & Non-Goals

### Goals
- Let authors add text entry fields to a `.ui.html` UI: SSIDs, passwords, hostnames, port numbers, device labels.
- Provide a modal on-screen keyboard that opens when an `<input>` is tapped, captures touch until dismissed, and writes the typed string back to the input.
- Ship two default keyboard layouts (alphanumeric + numeric) that work with zero author code, both replaceable/stylable via a `<keyboard>` template + CSS.
- Fit the existing retained-mode C++ runtime without disrupting the current element model (`.value` numeric stays; inputs get a `.text` string).

### Non-Goals
- Autocomplete, predictive text, history, or dictionaries.
- Multi-line text areas or rich text.
- Internationalization / non-ASCII charsets beyond the documented set.
- Per-key animation or haptic feedback.

### Use case
Configuration / settings entry on an ESP32 + ILI9341 (320×240 landscape, resistive XPT2046 touch). Short ASCII strings, rarely typed, simple keyboard is sufficient.

### Charset
Alphanumeric + common symbols: `a-z`, `0-9`, space, and `. _ - : / @ ,` with a shift layer for capitals. Full printable ASCII is out of scope for v1; the symbol page covers config-string needs.

---

## 2. Authoring Surface

### `<input>` element
```html
<input id="ssid" type="text" placeholder="SSID" maxlength="32"></input>
<input id="port" type="number" placeholder="8080" maxlength="5"></input>
```

| Attribute   | Values              | Default     | Meaning |
|-------------|---------------------|-------------|---------|
| `type`      | `text` \| `number`  | `text`      | Selects which default keyboard opens. |
| `placeholder` | string            | _(empty)_   | Shown in the field before any input (grayed via CSS `::placeholder`-style convention). |
| `maxlength` | integer             | `16`        | Caps input length. Bounded by `UI_TEXT_BUF` (raised to 32, see §5). |
| `keyboard`  | id reference        | _(default)_ | References a `<keyboard id="...">` to override the default for this field. |

Tapping the input opens the keyboard. The field shows its current text in the top display row of the keyboard overlay.

### `<keyboard>` template (optional override)
```html
<keyboard id="myKb" variant="alpha">
  <row><key>1</key><key>2</key> ... <key>0</key></row>
  <row><key>q</key><key>w</key> ... <key>p</key></row>
  ...
</keyboard>
<input id="ssid" keyboard="myKb"></input>
```

- A `<keyboard>` is a **sibling declaration**, not part of the rendered `<screen>` subtree (like a `<template>`). It is never rendered directly.
- `variant="alpha|number"` declares which shipped default to clone if the author omits rows, and is the fallback shape.
- If no `<keyboard>` exists in the file, or an input has no `keyboard` ref, the runtime uses the shipped default for the input's `type`.

### Authoring API (TypeScript)
```ts
screen.ssid.text            // string — current value
screen.ssid.text = "x"      // string — set value programmatically
screen.ssid.onChange(() => { console.log("new:", screen.ssid.text); })
```

`.value` is **not** used for text state on `<input>`; it remains numeric for `check`/`select`/`radio`/`range`. An `InputElement` type exposes `.text` and `.onChange`.

---

## 3. Default Keyboards

Both defaults are built-in `KeyboardTemplate` constants the transpiler ships, emitted exactly like author-written `<keyboard>` blocks. Both are replaceable.

### Default alpha (`variant="alpha"`)
10×4 grid, full-width bottom dock (~75% of screen height). Keys ~30×30px on a 320×240 display.

```
Row 0:  1 2 3 4 5 6 7 8 9 0
Row 1:  q w e r t y u i o p
Row 2:  ⇧ a s d f g h j k l ⌫
Row 3:  123 z x c v b n m _ OK
```

- `⇧` — shift: caps the next letter typed, then resets. (No caps-lock in v1.)
- `123` — swaps to the symbols page: `. , : ; - _ @ / ( )` then `! ? ' " + = % & # *`.
- `⌫` — backspace. Tap deletes one char; hold auto-repeats (see §6).
- `OK` — commits and closes.
- `_` — space (labeled `_` for screen brevity).

The symbols page is a second key-set; shift state does not apply to it.

### Default number (`variant="number"`)
3×4 grid, centered (~60% of screen height). Keys ~40×40px.

```
Row 0:  1 2 3 ⌫
Row 1:  4 5 6 .
Row 2:  7 8 9 -
Row 3:  ABC 0 OK
```

- `ABC` — cross-default jump: switches to the alpha keyboard while editing a number field (e.g. to type a hostname with letters).
- `.` and `-` — cover IP addresses, negative values, decimals.
- `⌫` and `OK` — as above.

### Runtime key-hit geometry
Layout is a uniform grid. `__ui_kb_box` is computed on open from display dimensions. Each key rect is `(box.w / cols) × (box.h / rows)`. Hit-test maps touch `(x,y)` → `(col,row)` → key index. Shift/page changes repopulate `__ui_kb_keys[]` and mark dirty — no layout recompute.

---

## 4. Transpile-Time Lowering

### Parsing
- `html-parser.ts`: add `input` to `SUPPORTED_TAGS`. Parse `type`, `placeholder`, `maxlength`, `keyboard` attributes onto `UIElementNode`. Add `keyboard` and `row`/`key` to supported tags for `<keyboard>` templates.
- `<keyboard>` is parsed into a separate `KeyboardTemplate { id, variant, rows: Key[][] }` collection, returned alongside the `<screen>` tree (not as a child of `<screen>`).
- `Key` is `{ ch: char, special: 0|1|2|3|4 }`: `0`=char insert, `1`=shift, `2`=backspace, `3`=ok, `4`=page-swap.

### Style resolution → model
- `style-resolver.ts` / `model.ts`: emit a node with `kind: "input"`, `textBuffer` seeded with `placeholder`, `maxlen` set from `maxlength` (default 16, capped at 32).
- Add `input` to `UINodeKindModel` and `nodeKind()`.

### C++ lowering
- `ui-lowering.ts`: `cppKind("input") = "NODE_INPUT"`. Add `INPUT` to the node-count regex in `ui-emitter.ts`.
- Emit a C++ loader function per `<keyboard>` (author-defined and default):
  ```cpp
  void __ui_kb_load_default_alpha() {
    __ui_kb_keyCount = 0;
    __ui_kb_keys[0] = { '1', 0 }; __ui_kb_keys[1] = { '2', 0 }; /* ... */
    __ui_kb_keyCount = 40;
  }
  ```
- Emit a dispatch table mapping input node index → loader function:
  ```cpp
  void (*__ui_kb_loaders[])() = {
    __ui_kb_load_default_alpha,   // node N = ssid (type=text)
    __ui_kb_load_default_number,  // node N+1 = port (type=number)
  };
  ```
  Only `<input>` nodes receive entries; a parallel `inputNodeIndex → globalNodeIndex` map resolves sparse indexing.

### `.text` access
- `expression-to-ir.ts`: `screen.ssid.text` read → `{ kind: "raw", value: "__ui_nodes[N].textBuffer" }`.
- `statement-to-ir.ts`: `screen.ssid.text = "x"` write → `strncpy(__ui_nodes[N].textBuffer, "x", UI_TEXT_BUF-1); __ui_nodes[N].textBuffer[UI_TEXT_BUF-1]=0; ui_mark_dirty(N);`.
- `onChange` → registered into the existing click/release handler tables (fires after `ui_kb_close`).

### `maxlen`
Stored as a new explicit `int16_t maxlen` field on `UINode` (see §5). Costs 2 bytes/node; for a settings-focused device with ~a dozen nodes this is negligible. Avoids overloading `.value`.

---

## 5. Runtime Architecture

The keyboard is a **separate runtime subsystem** — its own key array, draw pass, and hit-test — not modeled as `UINode` entries. Rationale: keys are uniform and numerous (40+); modeling each as a `UINode` would bloat the node table and entangle scroll/transition/hit-test logic. A dedicated flat array is simpler and uses less RAM.

### New runtime globals
```cpp
#define UI_KB_MAX 40

struct UIKey { char ch; uint8_t special; };  // special: 0=char,1=shift,2=bs,3=ok,4=page

UIRect  __ui_kb_box;            // overlay rect, computed on open
UIKey   __ui_kb_keys[UI_KB_MAX];// key grid for current page
uint8_t __ui_kb_keyCount;
char    __ui_kb_buffer[UI_TEXT_BUF + 1]; // in-progress text (null-terminated)
uint8_t __ui_kb_len;
uint8_t __ui_kb_maxlen;         // from the input node's maxlen
uint8_t __ui_kb_shift;
uint8_t __ui_kb_visible;
int8_t  __ui_kb_target;         // node index of input being edited (-1 = none)
uint32_t __ui_kb_bs_repeat;     // last auto-repeat deletion time (hold-⌫)
void    (*__ui_kb_onchange)();
```

### `UINode` changes
- Add `NODE_INPUT` to `UINodeKind`.
- Add `int16_t maxlen;` field to `UINode` (default 0 for non-input nodes).
- Raise `UI_TEXT_BUF` from 16 to 32 to accommodate SSIDs/hostnames.

### Open/dismiss flow
1. User taps an `<input>` node → hit-test returns its index.
2. Touch-down handler sees `kind == NODE_INPUT` → calls `ui_kb_open(nodeIndex)`:
   - Sets `__ui_kb_target`, copies the input's `textBuffer` into `__ui_kb_buffer`, reads `maxlen`.
   - Calls `__ui_kb_loaders[inputIndex]()` to populate `__ui_kb_keys[]`.
   - Sets `__ui_kb_visible = 1`.
3. While visible, hit-test is redirected: touches inside `__ui_kb_box` → `ui_kb_handle_touch(x,y)` (maps to key, performs action); touches outside are ignored (modal).
4. `OK` → `ui_kb_close()`: copies `__ui_kb_buffer` back into the input node's `textBuffer`, fires `__ui_kb_onchange` if set, sets `__ui_kb_visible = 0`, marks the input dirty.

### Per-frame draw
When `__ui_kb_visible`, `ui_tick` draws the overlay **after** the normal node pass:
1. Background `fillRect` over `__ui_kb_box` (opaque, hides app underneath).
2. Current-text display row at top (shows `__ui_kb_buffer` with a cursor `_`).
3. Each key: `fillRect` + centered label. Special keys (`⇧`, `⌫`, `OK`, `123`/`ABC`) get distinct styling via the loaded CSS-resolved colors.

The overlay fully redraws each frame while visible (small enough that incremental redraw isn't needed, unlike progress/scrollbar).

### Touch while editing
- Key tap (down + up <600ms inside a key): insert char / toggle shift / swap page / delete one (⌫).
- `⌫` hold (≥600ms): after the hold threshold, auto-repeat — delete one char every ~100ms until release. Tracked via `__ui_kb_bs_repeat` and `millis()`.
- `OK`: commit + close.
- Touch outside `__ui_kb_box`: ignored.

---

## 6. Behavior Summary

| Action | Result |
|--------|--------|
| Tap char key | Insert char at `__ui_kb_len` (if `< maxlen`), update display. |
| `⇧` tap | Toggle shift; next char is capitalized, then shift resets. |
| `123`/`ABC` tap | Swap key-set page (symbols for alpha; alpha for number). |
| `⌫` tap | Delete one char. |
| `⌫` hold | Auto-repeat delete every ~100ms until release. |
| `OK` | Commit `__ui_kb_buffer` → input `textBuffer`, fire `onChange`, close. |
| Tap outside keyboard | Ignored (modal). |

---

## 7. CSS Styling

The keyboard overlay is styleable through the same CSS pipeline as other elements. Keys resolve colors/borders from CSS rules that the transpiler lowers into the resolved style passed to the keyboard draw routine. Author can target:
- The keyboard background (`__ui_kb_box` fill).
- Key background/foreground/border (including `:pressed` state).
- The display row text color.

Styling keys via the `<keyboard>` template: a `<key>` inside a `<keyboard>` accepts `class` and is matched by normal CSS rules. These are resolved at transpile time into a per-key resolved style (`bg`/`fg`/`borderColor`) stored in a parallel `UIKeyStyle __ui_kb_styles[UI_KB_MAX]` array, read by the draw routine. The runtime keyboard is otherwise opaque to CSS — only keys declared in a `<keyboard>` template are styleable (the shipped defaults ship with their own default styling baked into this style array).

---

## 8. Files Touched

| File | Change |
|------|--------|
| `packages/cuttlefish/src/ui/html-parser.ts` | Parse `input`, `keyboard`, `row`, `key`. Return `KeyboardTemplate[]`. |
| `packages/cuttlefish/src/ui/style-resolver.ts` | Carry `type`, `placeholder`, `maxlength`, `keyboard` ref; resolve `<key>` styles. |
| `packages/cuttlefish/src/ui/model.ts` | Add `"input"` kind, `maxlen`, placeholder seeding. |
| `packages/cuttlefish/src/ir/transformers/ui-lowering.ts` | `cppKind("input")="NODE_INPUT"`; emit keyboard loader functions + dispatch table; emit `maxlen`. |
| `packages/cuttlefish/src/emit/emitters/ui-emitter.ts` | Add `INPUT` to node-count regex; emit keyboard globals/loader table. |
| `packages/cuttlefish/src/ui/runtime-header.ts` | Add `NODE_INPUT`, `maxlen` field, `UIKey` struct, keyboard globals, `ui_kb_open/close/handle_touch`, draw pass, raise `UI_TEXT_BUF` to 32. |
| `packages/cuttlefish/src/ir/expression-to-ir.ts` | `.text` read → `textBuffer`. |
| `packages/cuttlefish/src/ir/statement-to-ir.ts` | `.text` write → `strncpy` + dirty. |
| `packages/cuttlefish/src/ir/transformers/ui-call-resolver.ts` | `onChange` registration for inputs. |
| `packages/cuttlefish/src/ir/ui-element-auto-wire.ts` | (If needed) input tap → open keyboard wiring. |
| `packages/ui/src/types.ts` | Add `InputElement` (`.text`, `.onChange`). |
| `demo-ui/src/hello.ui.html` | Add `<input>` fields to demo. |

---

## 9. Testing Strategy

- **Unit (host-side):** parse `<input>` and `<keyboard>` HTML; verify `KeyboardTemplate` extraction; verify lowering emits `NODE_INPUT` + correct loader function; verify `.text` read/write IR.
- **Runtime-header tests:** extend the existing runtime-header test suite to cover keyboard open/close, char insertion, shift, page-swap, ⌫ tap/hold-repeat, and the loader dispatch table.
- **E2e transpile:** a `.ui.html` with `<input>` fields produces a `main.ino` that compiles (catches struct field ordering, enum, regex coverage).
- **Hardware:** tap input → keyboard opens → type a string → OK → field shows the string; verify ⌫ tap/hold; verify number keyboard; verify `maxlength` cap.
