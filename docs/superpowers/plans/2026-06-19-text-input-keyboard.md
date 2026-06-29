# Text Input & On-Screen Keyboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `<input>` text entry to the TypeHAL UI library, backed by a modal on-screen keyboard overlay with two replaceable defaults (alphanumeric + numeric).

**Architecture:** The keyboard is a separate runtime subsystem — its own `UIKey[]` array, draw pass, and modal hit-test — not modeled as `UINode`s. Authors write `<input>` (and optionally a `<keyboard>` template); the transpiler parses, lowers to `NODE_INPUT` nodes + a per-keyboard key-set loader function + a dispatch table, and emits C++ runtime support. Typed text flows through the input node's `textBuffer`, exposed to TS as `.text`.

**Tech Stack:** TypeScript (cuttlefish transpiler), C++ (device runtime), Vitest (host-side tests), Arduino/ESP32 + Adafruit ILI9341 (hardware).

**Spec:** `docs/superpowers/specs/2026-06-19-text-input-keyboard-design.md`

---

## File Structure

**Host-side (TypeScript transpiler):**

| File | Responsibility |
|------|----------------|
| `packages/cuttlefish/src/ui/html-parser.ts` | Parse `<input>`, `<keyboard>`, `<row>`, `<key>`. Return `KeyboardTemplate[]` alongside the tree. |
| `packages/cuttlefish/src/ui/default-keyboards.ts` | **New file.** Built-in `KeyboardTemplate` constants for alpha + numeric defaults. |
| `packages/cuttlefish/src/ui/style-resolver.ts` | Carry `type`, `placeholder`, `maxlength`, `keyboard` ref + `maxlen` through `StyledNode`. |
| `packages/cuttlefish/src/ui/model.ts` | Add `"input"` kind + `maxlen` to `UINodeModel`. |
| `packages/cuttlefish/src/ui/layout-engine.ts` | Add `measure()` for `input`. |
| `packages/cuttlefish/src/ir/transformers/ui-lowering.ts` | `cppKind("input")`, emit `maxlen`, emit keyboard loader functions + dispatch table. |
| `packages/cuttlefish/src/emit/emitters/ui-emitter.ts` | Add `INPUT` to node-count regex; emit keyboard globals + loader extern table. |
| `packages/cuttlefish/src/ui/runtime-header.ts` | Add `NODE_INPUT`, `maxlen`, `UIKey`, keyboard globals, `ui_kb_open/close/handle_touch`, draw pass; raise `UI_TEXT_BUF` to 32. |
| `packages/cuttlefish/src/ui/ui-registry.ts` | Carry `keyboards: KeyboardTemplate[]` + `inputSpecs` through the module/lower pipeline. |
| `packages/cuttlefish/src/ir/expression-to-ir.ts` | `.text` read → `textBuffer`. |
| `packages/cuttlefish/src/ir/statement-to-ir.ts` | `.text` write → `strncpy` + dirty. |
| `packages/cuttlefish/src/ir/transformers/ui-call-resolver.ts` | Track `inputId → nodeIndex` for `.text` resolution; record `onChange`. |
| `packages/ui/src/types.ts` | Add `InputElement` type. |

**Tests (host-side):**

| File | What it covers |
|------|----------------|
| `tests/packages/cuttlefish/html-parser.test.ts` | `<input>` and `<keyboard>` parsing. |
| `tests/packages/cuttlefish/runtime-header.test.ts` | Keyboard runtime symbols present. |
| `tests/packages/cuttlefish/ui-lowering.test.ts` | `NODE_INPUT` + loader function emission. |
| `tests/packages/cuttlefish/ui-model.test.ts` | `input` kind + `maxlen`. |

**Demo:**

| File | Change |
|------|--------|
| `demo-ui/src/hello.ui.html` | Add `<input>` fields. |
| `demo-ui/src/main.ts` | Read `.text`, register `onChange`. |

---

## Task 1: Parse `<input>` in the HTML parser

**Files:**
- Modify: `packages/cuttlefish/src/ui/html-parser.ts`
- Test: `tests/packages/cuttlefish/html-parser.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `tests/packages/cuttlefish/html-parser.test.ts` (append inside the `describe` block, before its closing `});`):

```typescript
  it("parses <input> with type, placeholder, maxlength", () => {
    const tree = parseHtml(`<screen><input id="ssid" type="text" placeholder="SSID" maxlength="32"></input></screen>`);
    const input = tree.children[0];
    expect(input.tag).toBe("input");
    expect(input.id).toBe("ssid");
    expect(input.type).toBe("text");
    expect(input.placeholder).toBe("SSID");
    expect(input.maxlength).toBe(32);
  });

  it("defaults <input> type to text and maxlength to 16", () => {
    const tree = parseHtml(`<screen><input id="x"></input></screen>`);
    const input = tree.children[0];
    expect(input.type).toBe("text");
    expect(input.maxlength).toBe(16);
  });

  it("parses type=number", () => {
    const tree = parseHtml(`<screen><input id="port" type="number" maxlength="5"></input></screen>`);
    expect(tree.children[0].type).toBe("number");
    expect(tree.children[0].maxlength).toBe(5);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/packages/cuttlefish/html-parser.test.ts`
Expected: FAIL — `input.type`, `input.placeholder`, `input.maxlength` are `undefined`; tag `"input"` not in `SUPPORTED_TAGS` (throws "Unsupported tag").

- [ ] **Step 3: Add `input` to `SUPPORTED_TAGS` and extend `UIElementNode`**

In `packages/cuttlefish/src/ui/html-parser.ts`:

1. Add `"input"` to the `SUPPORTED_TAGS` set:

```typescript
const SUPPORTED_TAGS = new Set(["screen", "text", "button", "view", "check", "select", "option", "label", "radio", "progress", "range", "input"]);
```

2. Add the input-related fields to the `UIElementNode` interface (after the `max?: string;` line):

```typescript
  /** Input type (for <input>: "text" | "number"). */
  type?: "text" | "number";
  /** Placeholder (for <input>). */
  placeholder?: string;
  /** Max length (for <input>). */
  maxlength?: number;
  /** Keyboard ref id (for <input>). */
  keyboard?: string;
```

3. In `domToUIElementNode`, after the `maxAttr` line, parse the input attributes:

```typescript
  const minAttr = el.getAttribute("min") || undefined;
  const maxAttr = el.getAttribute("max") || undefined;
  const typeAttr = (el.getAttribute("type") === "number" ? "number" : "text") as "text" | "number" | undefined;
  const placeholderAttr = el.getAttribute("placeholder") || undefined;
  const maxlengthAttr = el.getAttribute("maxlength");
  const maxlengthNum = maxlengthAttr ? (parseInt(maxlengthAttr, 10) || 16) : undefined;
  const keyboardAttr = el.getAttribute("keyboard") || undefined;
```

(Add the `typeAttr`, `placeholderAttr`, `maxlengthNum`, `keyboardAttr` lines. The first two lines already exist — keep them; only append the four new ones.)

4. Update the `node` object construction (the line starting `const node: UIElementNode =`) to include the new fields:

```typescript
  const node: UIElementNode = { tag: effectiveTag, id, classes, text, value: valueAttr, name: nameAttr, checked: checkedAttr, min: minAttr, max: maxAttr, type: typeAttr, placeholder: placeholderAttr, maxlength: maxlengthNum, keyboard: keyboardAttr, children: [] };
```

Note: for `<input>`, `typeAttr` must be defined even when the attribute is absent (default `"text"`). Adjust the `typeAttr` computation so it only returns `undefined` for non-input tags:

```typescript
  const typeAttr = tag === "input"
    ? (el.getAttribute("type") === "number" ? "number" : "text")
    : undefined;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/packages/cuttlefish/html-parser.test.ts`
Expected: PASS — all input parsing tests pass, existing tests still pass.

- [ ] **Step 5: Commit**

```bash
git add packages/cuttlefish/src/ui/html-parser.ts tests/packages/cuttlefish/html-parser.test.ts
git commit -m "feat(ui): parse <input> with type, placeholder, maxlength"
```

---

## Task 2: Parse `<keyboard>` templates

**Files:**
- Modify: `packages/cuttlefish/src/ui/html-parser.ts`
- Test: `tests/packages/cuttlefish/html-parser.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `tests/packages/cuttlefish/html-parser.test.ts`:

```typescript
  it("parses a <keyboard> template alongside <screen>", () => {
    const result = parseHtmlWithKeyboards(`<screen><input id="ssid"></input></screen>
<keyboard id="myKb" variant="alpha">
  <row><key>1</key><key>2</key></row>
  <row><key>q</key><key>w</key></row>
</keyboard>`);
    expect(result.tree.tag).toBe("screen");
    expect(result.keyboards).toHaveLength(1);
    expect(result.keyboards[0].id).toBe("myKb");
    expect(result.keyboards[0].variant).toBe("alpha");
    expect(result.keyboards[0].rows).toHaveLength(2);
    expect(result.keyboards[0].rows[0]).toEqual([
      { ch: "1", special: 0 },
      { ch: "2", special: 0 },
    ]);
  });

  it("returns empty keyboards array when no <keyboard> present", () => {
    const result = parseHtmlWithKeyboards(`<screen><text id="t">hi</text></screen>`);
    expect(result.keyboards).toEqual([]);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/packages/cuttlefish/html-parser.test.ts`
Expected: FAIL — `parseHtmlWithKeyboards` is not exported.

- [ ] **Step 3: Add keyboard types and parsing**

In `packages/cuttlefish/src/ui/html-parser.ts`:

1. Add the `KeyboardTemplate` types after the `UIElementNode` interface:

```typescript
/** A single key in a keyboard template. */
export interface UIKeyTemplate {
  /** Character to insert, or label for special keys. */
  ch: string;
  /** 0=char, 1=shift, 2=backspace, 3=ok, 4=page-swap. */
  special: 0 | 1 | 2 | 3 | 4;
}

/** A keyboard template parsed from <keyboard>. */
export interface KeyboardTemplate {
  id: string;
  variant: "alpha" | "number";
  rows: UIKeyTemplate[][];
}

export interface ParsedHtml {
  tree: UIElementNode;
  keyboards: KeyboardTemplate[];
}
```

2. Add `"keyboard"`, `"row"`, `"key"` to `SUPPORTED_TAGS`:

```typescript
const SUPPORTED_TAGS = new Set(["screen", "text", "button", "view", "check", "select", "option", "label", "radio", "progress", "range", "input", "keyboard", "row", "key"]);
```

3. Add the `parseHtmlWithKeyboards` function after `parseHtml`:

```typescript
/** Parse HTML, returning both the <screen> tree and any <keyboard> templates. */
export function parseHtmlWithKeyboards(src: string): ParsedHtml {
  const withoutComments = src.replace(/<!--[\s\S]*?-->/g, "");
  const wrapped = `<div id="__root__">${withoutComments}</div>`;
  const { document } = parseHTML(wrapped);
  const root = document.getElementById("__root__");
  if (!root) {
    throw new Error("UI HTML: failed to parse document");
  }

  // Parse keyboards first (they are siblings of <screen>, not children).
  const keyboards: KeyboardTemplate[] = [];
  for (const child of Array.from(root.children)) {
    if (child.tagName.toLowerCase() !== "keyboard") continue;
    keyboards.push(parseKeyboardElement(child));
  }

  // Reuse parseHtml for the screen tree.
  const tree = parseHtml(src);
  return { tree, keyboards };
}

/** Parse a <keyboard> element into a KeyboardTemplate. */
function parseKeyboardElement(el: Element): KeyboardTemplate {
  const id = el.getAttribute("id") || "";
  const variantAttr = el.getAttribute("variant");
  const variant: "alpha" | "number" = variantAttr === "number" ? "number" : "alpha";
  const rows: UIKeyTemplate[][] = [];
  for (const rowEl of Array.from(el.children)) {
    if (rowEl.tagName.toLowerCase() !== "row") continue;
    const row: UIKeyTemplate[] = [];
    for (const keyEl of Array.from(rowEl.children)) {
      if (keyEl.tagName.toLowerCase() !== "key") continue;
      row.push(parseKeyElement(keyEl));
    }
    if (row.length > 0) rows.push(row);
  }
  return { id, variant, rows };
}

/** Parse a <key> element. Special keys are identified by their label. */
function parseKeyElement(el: Element): UIKeyTemplate {
  const label = el.textContent?.trim() || "";
  const specialAttr = el.getAttribute("special");
  if (specialAttr !== null) {
    const s = parseInt(specialAttr, 10);
    if (s >= 1 && s <= 4) return { ch: label, special: s as 1 | 2 | 3 | 4 };
  }
  // Recognize special keys by conventional labels.
  if (label === "⇧" || label.toUpperCase() === "SHIFT") return { ch: label, special: 1 };
  if (label === "⌫" || label.toUpperCase() === "BACKSPACE") return { ch: label, special: 2 };
  if (label.toUpperCase() === "OK") return { ch: label, special: 3 };
  // 123 / ABC are page-swap keys (their ch carries the label to draw).
  if (label === "123" || label.toUpperCase() === "ABC") return { ch: label, special: 4 };
  return { ch: label, special: 0 };
}
```

4. Make `parseHtml` skip `<keyboard>` (it currently looks only at `<screen>` children, which is correct — but the existing `childElements` filter in `domToUIElementNode` must not try to descend into a `<keyboard>` if one is nested. Since keyboards are siblings of `<screen>`, this is already fine. No change needed to `parseHtml` itself, but verify no regression.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/packages/cuttlefish/html-parser.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/cuttlefish/src/ui/html-parser.ts tests/packages/cuttlefish/html-parser.test.ts
git commit -m "feat(ui): parse <keyboard> templates with rows and keys"
```

---

## Task 3: Define the built-in default keyboards

**Files:**
- Create: `packages/cuttlefish/src/ui/default-keyboards.ts`
- Test: `tests/packages/cuttlefish/default-keyboards.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/packages/cuttlefish/default-keyboards.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { DEFAULT_ALPHA_KEYBOARD, DEFAULT_NUMBER_KEYBOARD } from "@typecad/cuttlefish/ui/default-keyboards";

describe("Default keyboard templates", () => {
  it("alpha keyboard has 4 rows of 10 keys", () => {
    expect(DEFAULT_ALPHA_KEYBOARD.id).toBe("__default_alpha");
    expect(DEFAULT_ALPHA_KEYBOARD.variant).toBe("alpha");
    expect(DEFAULT_ALPHA_KEYBOARD.rows).toHaveLength(4);
    for (const row of DEFAULT_ALPHA_KEYBOARD.rows) {
      expect(row).toHaveLength(10);
    }
  });

  it("alpha row 0 is digits 1-0", () => {
    const chs = DEFAULT_ALPHA_KEYBOARD.rows[0].map(k => k.ch);
    expect(chs).toEqual(["1","2","3","4","5","6","7","8","9","0"]);
  });

  it("alpha keyboard has shift (special=1) and backspace (special=2)", () => {
    const all = DEFAULT_ALPHA_KEYBOARD.rows.flat();
    expect(all.some(k => k.special === 1)).toBe(true);  // shift
    expect(all.some(k => k.special === 2)).toBe(true);  // backspace
    expect(all.some(k => k.special === 3)).toBe(true);  // ok
    expect(all.some(k => k.special === 4)).toBe(true);  // 123 page-swap
  });

  it("number keyboard has 4 rows", () => {
    expect(DEFAULT_NUMBER_KEYBOARD.id).toBe("__default_number");
    expect(DEFAULT_NUMBER_KEYBOARD.variant).toBe("number");
    expect(DEFAULT_NUMBER_KEYBOARD.rows).toHaveLength(4);
  });

  it("number keyboard digits cover 0-9", () => {
    const chs = DEFAULT_NUMBER_KEYBOARD.rows.flat().filter(k => k.special === 0).map(k => k.ch);
    for (const d of ["0","1","2","3","4","5","6","7","8","9"]) {
      expect(chs).toContain(d);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/packages/cuttlefish/default-keyboards.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Create the default-keyboards module**

Create `packages/cuttlefish/src/ui/default-keyboards.ts`:

```typescript
// ---------------------------------------------------------------------------
// Built-in default keyboard templates — emitted by the transpiler when an
// <input> has no explicit <keyboard> ref. Both are KeyboardTemplate constants
// (same shape as author-written <keyboard> blocks) so the lowering path is
// uniform: a loader function is generated for each.
// ---------------------------------------------------------------------------

import type { KeyboardTemplate, UIKeyTemplate } from "./html-parser.js";

const k = (ch: string): UIKeyTemplate => ({ ch, special: 0 });

// Alpha: 10×4 grid (bottom dock). Row 2 has shift + backspace; row 3 has
// 123 (page-swap to symbols), space (_), and OK.
export const DEFAULT_ALPHA_KEYBOARD: KeyboardTemplate = {
  id: "__default_alpha",
  variant: "alpha",
  rows: [
    [k("1"), k("2"), k("3"), k("4"), k("5"), k("6"), k("7"), k("8"), k("9"), k("0")],
    [k("q"), k("w"), k("e"), k("r"), k("t"), k("y"), k("u"), k("i"), k("o"), k("p")],
    [
      { ch: "⇧", special: 1 },
      k("a"), k("s"), k("d"), k("f"), k("g"), k("h"), k("j"), k("k"), k("l"),
      { ch: "⌫", special: 2 },
    ],
    [
      { ch: "123", special: 4 },
      k("z"), k("x"), k("c"), k("v"), k("b"), k("n"), k("m"),
      k("_"),
      { ch: "OK", special: 3 },
    ],
  ],
};

// Number: 3×4-ish keypad (4 cols × 4 rows to keep the grid uniform). Covers
// digits, ".", "-", ABC (page-swap to alpha), backspace, OK.
export const DEFAULT_NUMBER_KEYBOARD: KeyboardTemplate = {
  id: "__default_number",
  variant: "number",
  rows: [
    [k("1"), k("2"), k("3"), { ch: "⌫", special: 2 }],
    [k("4"), k("5"), k("6"), k(".")],
    [k("7"), k("8"), k("9"), k("-")],
    [{ ch: "ABC", special: 4 }, k("0"), { ch: "OK", special: 3 }, { ch: "OK", special: 3 }],
  ],
};
```

Note: the number keyboard pads row 3 to 4 columns by duplicating OK in the last slot — the grid is uniform (4 cols) so hit-mapping stays simple; the duplicate OK cell is harmless (both commit). If you prefer a 3-wide grid for number, adjust `__ui_kb_cols` per-keyboard at load time (see Task 7) — but for v1 a uniform 4-col grid is simpler.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/packages/cuttlefish/default-keyboards.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/cuttlefish/src/ui/default-keyboards.ts tests/packages/cuttlefish/default-keyboards.test.ts
git commit -m "feat(ui): add built-in alpha and numeric default keyboards"
```

---

## Task 4: Carry input attributes through the model

**Files:**
- Modify: `packages/cuttlefish/src/ui/style-resolver.ts`
- Modify: `packages/cuttlefish/src/ui/model.ts`
- Modify: `packages/cuttlefish/src/ui/layout-engine.ts`
- Test: `tests/packages/cuttlefish/ui-model.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `tests/packages/cuttlefish/ui-model.test.ts` (if the file has a `describe` block, add inside it; otherwise create a new `describe`):

```typescript
  it("lowers an <input> node to kind 'input' with maxlen and placeholder", () => {
    const styled: StyledNode = {
      tag: "input",
      id: "ssid",
      classes: [],
      style: {},
      children: [],
      type: "text",
      placeholder: "SSID",
      maxlen: 32,
    };
    const boxes: Box[] = [{ x: 0, y: 0, w: 100, h: 20 }];
    const prog = lowerUIToModel(styled, boxes, "rgb565");
    expect(prog.nodes[0].kind).toBe("input");
    expect(prog.nodes[0].maxlen).toBe(32);
    expect(prog.nodes[0].textBuffer).toBe("SSID");
  });
```

You will need to import `StyledNode`, `Box`, and `lowerUIToModel` at the top of the test file. Check the existing imports in that file and add:

```typescript
import type { StyledNode } from "@typecad/cuttlefish/ui/style-resolver";
import type { Box } from "@typecad/cuttlefish/ui/layout-engine";
import { lowerUIToModel } from "@typecad/cuttlefish/ui/model";
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/packages/cuttlefish/ui-model.test.ts`
Expected: FAIL — `type`, `placeholder`, `maxlen` not on `StyledNode`; `kind: "input"` not produced by `nodeKind`; `maxlen` not on `UINodeModel`.

- [ ] **Step 3: Extend `StyledNode`**

In `packages/cuttlefish/src/ui/style-resolver.ts`, add fields to `StyledNode` (after `max?: string;`):

```typescript
  /** For <input>: text or number keyboard. */
  type?: "text" | "number";
  /** For <input>: placeholder text. */
  placeholder?: string;
  /** For <input>: max character length. */
  maxlen?: number;
  /** For <input>: keyboard template id ref. */
  keyboard?: string;
```

In `resolveNode`, populate them in the returned object (add after `max: node.max,`):

```typescript
    type: node.type,
    placeholder: node.placeholder,
    maxlen: node.maxlength,
    keyboard: node.keyboard,
```

- [ ] **Step 4: Add `"input"` kind and `maxlen` to the model**

In `packages/cuttlefish/src/ui/model.ts`:

1. Extend `UINodeKindModel`:

```typescript
export type UINodeKindModel = "fill" | "text" | "button" | "check" | "radio" | "progress" | "range" | "input";
```

2. Add `maxlen` to the `UINodeModel` interface (after `rangeMax: number;`):

```typescript
  rangeMin: number;
  rangeMax: number;
  /** For <input>: max character length (0 = use UI_TEXT_BUF). */
  maxlen: number;
```

3. Add `"input"` to `nodeKind()`:

```typescript
function nodeKind(tag: string): UINodeKindModel {
  if (tag === "screen" || tag === "view") return "fill";
  if (tag === "button") return "button";
  if (tag === "check") return "check";
  if (tag === "radio") return "radio";
  if (tag === "progress") return "progress";
  if (tag === "range") return "range";
  if (tag === "input") return "input";
  return "text";
}
```

4. In the `nodes.map` return object, populate `maxlen` and seed `textBuffer` with the placeholder. Find the line with `rangeMin: 0,` / `rangeMax: 100,` and the `textBuffer: "",` line, and update:

```typescript
      textBuffer: node.placeholder ?? "",
```

```typescript
      rangeMin: node.min ? (parseInt(node.min, 10) || 0) : 0,
      rangeMax: node.max ? (parseInt(node.max, 10) || 100) : 100,
      maxlen: node.maxlen ?? 0,
```

- [ ] **Step 5: Add `measure()` for `input`**

In `packages/cuttlefish/src/ui/layout-engine.ts`, add a branch in `measure()` (after the `range` branch, before the default `return { w: 0, h: 0 }`):

```typescript
  if (node.tag === "input") {
    // Input field: sized to the placeholder or a default width, 20px tall.
    const text = node.placeholder ?? "";
    const textW = text.length > 0 ? text.length * GFX_ADVANCE_PER_CHAR : 120;
    return { w: Math.max(textW + 16, 120), h: 20 };
  }
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npx vitest run tests/packages/cuttlefish/ui-model.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/cuttlefish/src/ui/style-resolver.ts packages/cuttlefish/src/ui/model.ts packages/cuttlefish/src/ui/layout-engine.ts tests/packages/cuttlefish/ui-model.test.ts
git commit -m "feat(ui): carry input type/placeholder/maxlen through model"
```

---

## Task 5: Lower `input` → `NODE_INPUT` + emit `maxlen`

**Files:**
- Modify: `packages/cuttlefish/src/ir/transformers/ui-lowering.ts`
- Modify: `packages/cuttlefish/src/emit/emitters/ui-emitter.ts`
- Test: `tests/packages/cuttlefish/ui-lowering.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `tests/packages/cuttlefish/ui-lowering.test.ts` (inside the existing `describe`):

```typescript
  it("lowers an input node to NODE_INPUT with maxlen", () => {
    const styled: StyledNode = {
      tag: "input",
      id: "ssid",
      classes: [],
      style: {},
      children: [],
      type: "text",
      placeholder: "SSID",
      maxlen: 32,
    };
    const boxes: Box[] = [{ x: 10, y: 10, w: 200, h: 20 }];
    const lowered = lowerUIToCpp(styled, boxes, "rgb565", "flash");
    expect(lowered.nodeTable).toContain("NODE_INPUT");
    expect(lowered.nodeTable).toContain(".maxlen=32");
  });
```

Add imports at the top of the test file if not present:

```typescript
import type { StyledNode } from "@typecad/cuttlefish/ui/style-resolver";
import type { Box } from "@typecad/cuttlefish/ui/layout-engine";
import { lowerUIToCpp } from "@typecad/cuttlefish/ir/transformers/ui-lowering";
```

(Check existing imports in that file — the `lowerUIToCpp` and type imports may already be there. Only add what's missing.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/packages/cuttlefish/ui-lowering.test.ts`
Expected: FAIL — `NODE_INPUT` not emitted (the `cppKind` switch falls through / returns undefined for `"input"`); `.maxlen=` not in node table.

- [ ] **Step 3: Add `"input"` to `cppKind()` and emit `maxlen`**

In `packages/cuttlefish/src/ir/transformers/ui-lowering.ts`:

1. Add the `input` case to `cppKind()`:

```typescript
function cppKind(kind: UINodeModel["kind"]): string {
  switch (kind) {
    case "fill": return "NODE_FILL";
    case "button": return "NODE_BUTTON";
    case "check": return "NODE_CHECK";
    case "radio": return "NODE_RADIO";
    case "progress": return "NODE_PROGRESS";
    case "range": return "NODE_RANGE";
    case "input": return "NODE_INPUT";
    case "text": return "NODE_TEXT";
  }
}
```

2. In the `emitNodeTable` line template, add `.maxlen=${n.maxlen}`. Insert it after `.rangeMax=${n.rangeMax},` and before `.dirty=0`:

```typescript
    return `  { .box=${box}, .bg=${hex(n.bg)}, .fg=${hex(n.fg)}, .kind=${cppKind(n.kind)}, .text=${text}, .textBuffer={0}, .hasTextBinding=0, .font=${font}, .hasBg=${n.hasBg ? 1 : 0}, .textAlign=${n.textAlign}, .borderColor=${hex(n.borderColor)}, .borderStyle=${n.borderStyle}, .underline=${n.underline ? 1 : 0}, .visible=${n.visible ? 1 : 0}, .clearColor=${hex(n.clearColor)}, .lastTextWidth=${lastTextWidth}, .scrollable=${n.scrollable ? 1 : 0}, .scrollY=0, .contentHeight=${n.contentHeight}, .parent=${parent}, .subtreeEnd=${n.subtreeEnd}, .rangeMin=${n.rangeMin}, .rangeMax=${n.rangeMax}, .maxlen=${n.maxlen}, .dirty=0, .value=${n.checked ? 1 : 0} },`;
```

- [ ] **Step 4: Add `INPUT` to the node-count regex**

In `packages/cuttlefish/src/emit/emitters/ui-emitter.ts`, update `countNodes`:

```typescript
function countNodes(nodeTable: string): number {
  const matches = nodeTable.match(/NODE_(FILL|TEXT|BUTTON|CHECK|RADIO|PROGRESS|RANGE|INPUT)/g);
  return matches ? matches.length : 0;
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/packages/cuttlefish/ui-lowering.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/cuttlefish/src/ir/transformers/ui-lowering.ts packages/cuttlefish/src/emit/emitters/ui-emitter.ts tests/packages/cuttlefish/ui-lowering.test.ts
git commit -m "feat(ui): lower <input> to NODE_INPUT and emit maxlen"
```

---

## Task 6: Runtime header — `NODE_INPUT`, `maxlen`, raise `UI_TEXT_BUF` to 32

**Files:**
- Modify: `packages/cuttlefish/src/ui/runtime-header.ts`
- Test: `tests/packages/cuttlefish/runtime-header.test.ts`

- [ ] **Step 1: Write the failing test**

In `tests/packages/cuttlefish/runtime-header.test.ts`:

1. Update the existing `UI_TEXT_BUF` test (line ~42) from 16 to 32:

```typescript
  it("defines UI_TEXT_BUF as 32", () => {
    expect(header).toMatch(/#define\s+UI_TEXT_BUF\s+32/);
  });
```

2. Add new tests (append inside the `describe` block):

```typescript
  it("declares NODE_INPUT in the UINodeKind enum", () => {
    expect(header).toMatch(/NODE_RANGE,\s*NODE_INPUT/);
  });

  it("UINode has a maxlen field", () => {
    expect(header).toMatch(/int16_t\s+maxlen/);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/packages/cuttlefish/runtime-header.test.ts`
Expected: FAIL — `UI_TEXT_BUF` is 16; `NODE_INPUT` not in enum; `maxlen` field absent.

- [ ] **Step 3: Apply the runtime-header changes**

In `packages/cuttlefish/src/ui/runtime-header.ts`:

1. Change the `UI_TEXT_BUF` define:

```typescript
#define UI_TEXT_BUF 32   // single source of truth: UINode field + textFn size arg + snprintf bound
```

2. Add `NODE_INPUT` to the enum:

```typescript
enum UINodeKind { NODE_FILL, NODE_TEXT, NODE_BUTTON, NODE_CHECK, NODE_RADIO, NODE_PROGRESS, NODE_RANGE, NODE_INPUT };
```

3. Add the `maxlen` field to `UINode` (after `rangeMax`):

```typescript
  int16_t rangeMin;     // for <range>: minimum value
  int16_t rangeMax;     // for <range>: maximum value
  int16_t maxlen;       // for <input>: max character length (0 = UI_TEXT_BUF)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/packages/cuttlefish/runtime-header.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/cuttlefish/src/ui/runtime-header.ts tests/packages/cuttlefish/runtime-header.test.ts
git commit -m "feat(ui): NODE_INPUT kind, maxlen field, raise UI_TEXT_BUF to 32"
```

---

## Task 7: Runtime header — keyboard subsystem (struct + globals + open/close)

**Files:**
- Modify: `packages/cuttlefish/src/ui/runtime-header.ts`
- Test: `tests/packages/cuttlefish/runtime-header.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `tests/packages/cuttlefish/runtime-header.test.ts`:

```typescript
  it("declares the keyboard subsystem structs and globals", () => {
    expect(header).toMatch(/struct\s+UIKey\s*\{\s*char\s+ch;\s*uint8_t\s+special;\s*\}/);
    expect(header).toMatch(/#define\s+UI_KB_MAX\s+40/);
    expect(header).toContain("__ui_kb_keys");
    expect(header).toContain("__ui_kb_buffer");
    expect(header).toContain("__ui_kb_visible");
    expect(header).toContain("__ui_kb_target");
  });

  it("declares ui_kb_open, ui_kb_close, ui_kb_handle_touch", () => {
    expect(header).toContain("ui_kb_open");
    expect(header).toContain("ui_kb_close");
    expect(header).toContain("ui_kb_handle_touch");
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/packages/cuttlefish/runtime-header.test.ts`
Expected: FAIL — none of the keyboard symbols are present.

- [ ] **Step 3: Add the keyboard subsystem**

In `packages/cuttlefish/src/ui/runtime-header.ts`, add this block before the closing `#endif` of the include guard. (Locate the final `#endif` for `__TC_UI_RUNTIME` and insert above it.)

```typescript

// ── On-screen keyboard subsystem ───────────────────────────────────────────
#define UI_KB_MAX 40
#define UI_KB_ROWS 4
#define UI_KB_COLS 10
#define UI_KB_HOLD_MS 600
#define UI_KB_REPEAT_MS 100

struct UIKey { char ch; uint8_t special; };  // special: 0=char,1=shift,2=bs,3=ok,4=page

// Populated by the per-keyboard loader function (emitted by the lowering).
static UIRect  __ui_kb_box;
static UIKey   __ui_kb_keys[UI_KB_MAX];
static uint8_t __ui_kb_keyCount;
static uint8_t __ui_kb_rows;
static uint8_t __ui_kb_cols;
static char    __ui_kb_buffer[UI_TEXT_BUF + 1];
static uint8_t __ui_kb_len;
static uint8_t __ui_kb_maxlen;
static uint8_t __ui_kb_shift;
static uint8_t __ui_kb_visible;
static int8_t  __ui_kb_target;       // node index of input being edited (-1 = none)
static uint8_t __ui_kb_bs_held;      // backspace key currently held
static uint32_t __ui_kb_bs_repeat;   // last auto-repeat deletion time
static void    (*__ui_kb_onchange)();
// Dispatch table: one loader per input node. Indexed by input position.
extern void (*__ui_kb_loaders[])();
extern const uint8_t __ui_kb_loader_count;

// Insert a character into the buffer (if space permits).
static inline void ui_kb_insert(char c) {
  if (__ui_kb_len >= __ui_kb_maxlen && __ui_kb_maxlen > 0) return;
  if (__ui_kb_len >= UI_TEXT_BUF) return;
  __ui_kb_buffer[__ui_kb_len++] = c;
  __ui_kb_buffer[__ui_kb_len] = 0;
}

// Delete one character from the buffer.
static inline void ui_kb_delete() {
  if (__ui_kb_len == 0) return;
  __ui_kb_buffer[--__ui_kb_len] = 0;
}

// Open the keyboard for an input node.
static inline void ui_kb_open(uint8_t nodeIdx) {
  __ui_kb_target = (int8_t)nodeIdx;
  strncpy(__ui_kb_buffer, __ui_nodes[nodeIdx].textBuffer, UI_TEXT_BUF);
  __ui_kb_buffer[UI_TEXT_BUF] = 0;
  __ui_kb_len = strlen(__ui_kb_buffer);
  uint16_t ml = __ui_nodes[nodeIdx].maxlen;
  __ui_kb_maxlen = (ml > 0 && ml <= UI_TEXT_BUF) ? (uint8_t)ml : UI_TEXT_BUF;
  __ui_kb_shift = 0;
  __ui_kb_bs_held = 0;
  // Load the key set via the dispatch table (caller resolves input position).
  // The loader sets __ui_kb_keys, __ui_kb_keyCount, __ui_kb_rows, __ui_kb_cols.
  // __ui_kb_box is computed from rows/cols + display size.
  __ui_kb_visible = 1;
  // Mark the whole tree dirty so the overlay draws cleanly over it.
  for (uint8_t i = 0; i < __ui_node_count; i++) __ui_nodes[i].dirty = 1;
}

// Close the keyboard: commit buffer back to the input node.
static inline void ui_kb_close() {
  if (__ui_kb_target >= 0) {
    strncpy(__ui_nodes[__ui_kb_target].textBuffer, __ui_kb_buffer, UI_TEXT_BUF);
    __ui_nodes[__ui_kb_target].textBuffer[UI_TEXT_BUF] = 0;
    ui_mark_dirty((uint8_t)__ui_kb_target);
    if (__ui_kb_onchange) __ui_kb_onchange();
  }
  __ui_kb_visible = 0;
  __ui_kb_target = -1;
  __ui_kb_bs_held = 0;
}

// Compute a key's rect from its index, given the grid + box.
static inline void ui_kb_key_rect(uint8_t idx, UIRect* out) {
  uint8_t col = idx % __ui_kb_cols;
  uint8_t row = idx / __ui_kb_cols;
  out->x = __ui_kb_box.x + (int16_t)col * __ui_kb_box.w / __ui_kb_cols;
  out->y = __ui_kb_box.y + (int16_t)row * __ui_kb_box.h / __ui_kb_rows;
  out->w = __ui_kb_box.w / __ui_kb_cols;
  out->h = __ui_kb_box.h / __ui_kb_rows;
}

// Handle a touch inside the keyboard box. tx,ty are display coords.
static inline void ui_kb_handle_touch(int16_t tx, int16_t ty) {
  for (uint8_t i = 0; i < __ui_kb_keyCount; i++) {
    UIRect r;
    ui_kb_key_rect(i, &r);
    if (tx >= r.x && tx < r.x + r.w && ty >= r.y && ty < r.y + r.h) {
      UIKey k = __ui_kb_keys[i];
      if (k.special == 2) {
        // backspace: mark held; actual deletion in the repeat handler
        __ui_kb_bs_held = 1;
        ui_kb_delete();
      }
      return;  // only one key per touch
    }
  }
}

// Called each frame while the keyboard is visible + a touch is down.
// Handles backspace auto-repeat.
static inline void ui_kb_tick(uint32_t now, uint8_t touching) {
  if (!__ui_kb_bs_held) return;
  if (!touching) { __ui_kb_bs_held = 0; return; }
  if (now - __ui_kb_bs_repeat >= UI_KB_REPEAT_MS) {
    ui_kb_delete();
    __ui_kb_bs_repeat = now;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/packages/cuttlefish/runtime-header.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/cuttlefish/src/ui/runtime-header.ts tests/packages/cuttlefish/runtime-header.test.ts
git commit -m "feat(ui): keyboard subsystem — UIKey, globals, open/close, hit-test"
```

---

## Task 8: Runtime header — keyboard draw pass + touch routing

**Files:**
- Modify: `packages/cuttlefish/src/ui/runtime-header.ts`
- Test: `tests/packages/cuttlefish/runtime-header.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `tests/packages/cuttlefish/runtime-header.test.ts`:

```typescript
  it("draws the keyboard overlay when visible", () => {
    expect(header).toContain("ui_kb_draw");
    expect(header).toMatch(/if\s*\(__ui_kb_visible\)[\s\S]*ui_kb_draw/);
  });

  it("routes touch to the keyboard when visible and inside the box", () => {
    expect(header).toMatch(/__ui_kb_visible[\s\S]*ui_kb_handle_touch/);
  });

  it("computes the keyboard box from display size and grid", () => {
    expect(header).toContain("__ui_kb_box.w");
    expect(header).toContain("__ui_kb_box.h");
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/packages/cuttlefish/runtime-header.test.ts`
Expected: FAIL — `ui_kb_draw` not present; no touch routing.

- [ ] **Step 3: Add the draw function and touch routing**

In `packages/cuttlefish/src/ui/runtime-header.ts`, add the draw function (append before the closing `#endif`, after the keyboard subsystem block from Task 7):

```typescript

// Compute the keyboard box on open. Full-width bottom dock for alpha;
// centered block for number. Uses __ui_display_w / __ui_display_h if defined
// (set by the emitter from the display profile), else 320×240.
#ifndef __ui_display_w
#define __ui_display_w 320
#endif
#ifndef __ui_display_h
#define __ui_display_h 240
#endif

static inline void ui_kb_compute_box() {
  // Bottom dock: full width, ~75% of height for alpha, ~60% for number.
  uint8_t isNumber = (__ui_kb_cols <= 4);
  uint16_t h = isNumber ? (__ui_display_h * 60 / 100) : (__ui_display_h * 75 / 100);
  __ui_kb_box.w = isNumber ? (__ui_display_w * 50 / 100) : __ui_display_w;
  __ui_kb_box.h = h;
  __ui_kb_box.x = isNumber ? (__ui_display_w - __ui_kb_box.w) / 2 : 0;
  __ui_kb_box.y = __ui_display_h - h;
}

// Draw the keyboard overlay. Called from ui_tick after the normal node pass.
static inline void ui_kb_draw() {
  // Opaque background
  __tc_display.fillRect(__ui_kb_box.x, __ui_kb_box.y, __ui_kb_box.w, __ui_kb_box.h, 0x0000);
  // Text display row (top of box): show buffer + cursor
  __tc_display.setCursor(__ui_kb_box.x + 4, __ui_kb_box.y + 2);
  __tc_display.setTextColor(0xFFFF, 0x0000);
  __tc_display.setTextSize(2);
  __tc_display.print(__ui_kb_buffer);
  __tc_display.print("_");  // cursor

  // Keys
  for (uint8_t i = 0; i < __ui_kb_keyCount; i++) {
    UIRect r;
    ui_kb_key_rect(i, &r);
    UIKey k = __ui_kb_keys[i];
    uint16_t bg = 0x4208;   // dark gray
    uint16_t fg = 0xFFFF;   // white
    if (k.special == 3) { bg = 0x2641; fg = 0xFFFF; }  // OK — blue accent
    if (k.special == 1 && __ui_kb_shift) { bg = 0xBDF7; } // shift active — highlight
    __tc_display.fillRect(r.x + 1, r.y + 1, r.w - 2, r.h - 2, bg);
    __tc_display.drawRect(r.x + 1, r.y + 1, r.w - 2, r.h - 2, fg);
    __tc_display.setCursor(r.x + 4, r.y + r.h / 2 - 4);
    __tc_display.setTextColor(fg, bg);
    __tc_display.setTextSize(1);
    // For char keys with shift active, capitalize.
    char label[2] = { k.ch, 0 };
    if (k.special == 0 && __ui_kb_shift && k.ch >= 'a' && k.ch <= 'z') label[0] = k.ch - 32;
    __tc_display.print(label);
  }
}
```

Now wire it into `ui_tick`. Find the `ui_tick` function in the runtime header. At the very end of `ui_tick` (after all node drawing + scrollbars), add:

```typescript
  // ── Keyboard overlay ──
  if (__ui_kb_visible) {
    ui_kb_draw();
  }
```

For touch routing: find `ui_handle_touch` in the runtime header. At the *top* of `ui_handle_touch` (before the existing hit-test logic), add a modal guard:

```typescript
static inline void ui_handle_touch(int16_t tx, int16_t ty) {
  // Modal keyboard: if visible, route touch to the keyboard only.
  if (__ui_kb_visible) {
    if (tx >= __ui_kb_box.x && tx < __ui_kb_box.x + __ui_kb_box.w &&
        ty >= __ui_kb_box.y && ty < __ui_kb_box.y + __ui_kb_box.h) {
      ui_kb_handle_touch(tx, ty);
    }
    return;  // swallow all other touches while modal
  }
  // ... existing hit-test logic follows ...
```

And call `ui_kb_compute_box()` inside `ui_kb_open` — add it right after `__ui_kb_visible = 1;`:

```typescript
  ui_kb_compute_box();
  __ui_kb_visible = 1;
```

(Order matters: compute the box before drawing.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/packages/cuttlefish/runtime-header.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/cuttlefish/src/ui/runtime-header.ts tests/packages/cuttlefish/runtime-header.test.ts
git commit -m "feat(ui): keyboard draw pass + modal touch routing"
```

---

## Task 9: Wire `NODE_INPUT` tap → `ui_kb_open` in the runtime

**Files:**
- Modify: `packages/cuttlefish/src/ui/runtime-header.ts`
- Test: `tests/packages/cuttlefish/runtime-header.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `tests/packages/cuttlefish/runtime-header.test.ts`:

```typescript
  it("opens the keyboard when a NODE_INPUT is tapped", () => {
    expect(header).toMatch(/kind\s*==\s*NODE_INPUT[\s\S]*ui_kb_open/);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/packages/cuttlefish/runtime-header.test.ts`
Expected: FAIL.

- [ ] **Step 3: Add NODE_INPUT tap handling**

In `packages/cuttlefish/src/ui/runtime-header.ts`, find `ui_touch_down` (the function that handles a new touch). Locate the block that handles `NODE_BUTTON` value-setting and `NODE_RANGE` tracking. After that block (still inside `if (node >= 0) {`), add the input case:

```typescript
    // Open the keyboard when an input is tapped.
    if (__ui_nodes[node].kind == NODE_INPUT) {
      ui_kb_open((uint8_t)node);
    }
```

This must be guarded so it only fires when the keyboard is *not* already visible (the modal guard in `ui_handle_touch` already prevents re-entry, but be explicit):

```typescript
    if (__ui_nodes[node].kind == NODE_INPUT && !__ui_kb_visible) {
      ui_kb_open((uint8_t)node);
    }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/packages/cuttlefish/runtime-header.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/cuttlefish/src/ui/runtime-header.ts tests/packages/cuttlefish/runtime-header.test.ts
git commit -m "feat(ui): open keyboard on NODE_INPUT tap"
```

---

## Task 10: Generate keyboard loader functions + dispatch table in lowering

**Files:**
- Modify: `packages/cuttlefish/src/ir/transformers/ui-lowering.ts`
- Modify: `packages/cuttlefish/src/ui/ui-registry.ts`
- Modify: `packages/cuttlefish/src/emit/emitters/ui-emitter.ts`
- Test: `tests/packages/cuttlefish/ui-lowering.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `tests/packages/cuttlefish/ui-lowering.test.ts`:

```typescript
  it("emits a keyboard loader function and dispatch table for an input", () => {
    const styled: StyledNode = {
      tag: "input",
      id: "ssid",
      classes: [],
      style: {},
      children: [],
      type: "text",
      placeholder: "SSID",
      maxlen: 32,
    };
    const boxes: Box[] = [{ x: 0, y: 0, w: 200, h: 20 }];
    const lowered = lowerUIToCpp(styled, boxes, "rgb565", "flash");
    // A loader function named after the default alpha keyboard.
    expect(lowered.keyboardLoaders).toContain("__ui_kb_load_default_alpha");
    // The dispatch table references it.
    expect(lowered.keyboardDispatch).toContain("__ui_kb_load_default_alpha");
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/packages/cuttlefish/ui-lowering.test.ts`
Expected: FAIL — `keyboardLoaders` and `keyboardDispatch` not on `LoweredUI`.

- [ ] **Step 3: Extend `LoweredUI` and emit loaders**

In `packages/cuttlefish/src/ir/transformers/ui-lowering.ts`:

1. Extend the `LoweredUI` interface:

```typescript
export interface LoweredUI {
  nodeTable: string;
  transitionTable: string;
  typeDecl: string;
  /** C++ keyboard loader function bodies (one per keyboard in use). */
  keyboardLoaders: string;
  /** C++ dispatch table mapping input node index → loader function. */
  keyboardDispatch: string;
}
```

2. Import the default keyboards and `KeyboardTemplate`:

```typescript
import { DEFAULT_ALPHA_KEYBOARD, DEFAULT_NUMBER_KEYBOARD } from "../../ui/default-keyboards.js";
import type { KeyboardTemplate, UIKeyTemplate } from "../../ui/html-parser.js";
```

3. Add a loader-function emitter. A loader sets `__ui_kb_keys`, `__ui_kb_keyCount`, `__ui_kb_rows`, `__ui_kb_cols`:

```typescript
function emitKeyboardLoader(name: string, kb: KeyboardTemplate): string {
  const rows = kb.rows;
  const cols = rows.length > 0 ? Math.max(...rows.map(r => r.length)) : 0;
  const lines: string[] = [];
  lines.push(`void ${name}() {`);
  lines.push(`  __ui_kb_rows = ${rows.length};`);
  lines.push(`  __ui_kb_cols = ${cols};`);
  lines.push(`  __ui_kb_keyCount = 0;`);
  for (const row of rows) {
    for (const key of row) {
      const chEsc = key.ch === "\\" ? "\\\\" : key.ch === "'" ? "\\'" : key.ch;
      lines.push(`  __ui_kb_keys[__ui_kb_keyCount++] = { '${chEsc}', ${key.special} };`);
    }
  }
  lines.push(`}`);
  return lines.join("\n");
}

/** Resolve the loader name for an input node based on its type / keyboard ref. */
function loaderNameForInput(input: { type?: string; keyboard?: string }, keyboards: KeyboardTemplate[]): string {
  if (input.keyboard) {
    const match = keyboards.find(k => k.id === input.keyboard);
    if (match) return `__ui_kb_load_${sanitizedId(match.id)}`;
  }
  return input.type === "number" ? "__ui_kb_load_default_number" : "__ui_kb_load_default_alpha";
}

function sanitizedId(id: string): string {
  return id.replace(/[^a-zA-Z0-9_]/g, "_");
}
```

4. In `lowerUIToCpp`, after computing the model, gather the inputs and emit the loaders + dispatch. The function needs access to the keyboards list and input specs — add them as parameters:

```typescript
export function lowerUIToCpp(
  root: StyledNode,
  boxes: Box[],
  colorFormat: ColorFormat,
  storage: Storage,
  keyboards: KeyboardTemplate[] = [],
): LoweredUI {
  void storage;
  const model = lowerUIToModel(root, boxes, colorFormat);

  const nodeTable = emitNodeTable(model);
  const transitionTable = emitTransitionTable(model);
  const typeDecl = emitTypeDecl(root);

  // Collect input nodes + their specs (type, keyboard ref) in tree order.
  const inputSpecs: Array<{ type?: string; keyboard?: string }> = [];
  const collectInputs = (n: StyledNode) => {
    if (n.tag === "input") inputSpecs.push({ type: n.type, keyboard: n.keyboard });
    n.children.forEach(collectInputs);
  };
  collectInputs(root);

  // Build the set of keyboards actually needed (defaults + any referenced).
  const neededKeyboards: KeyboardTemplate[] = [];
  const addIfNeeded = (kb: KeyboardTemplate) => {
    if (!neededKeyboards.some(k => k.id === kb.id)) neededKeyboards.push(kb);
  };
  for (const spec of inputSpecs) {
    if (spec.keyboard) {
      const match = keyboards.find(k => k.id === spec.keyboard);
      if (match) addIfNeeded(match);
    } else {
      addIfNeeded(spec.type === "number" ? DEFAULT_NUMBER_KEYBOARD : DEFAULT_ALPHA_KEYBOARD);
    }
  }

  const keyboardLoaders = neededKeyboards
    .map(kb => emitKeyboardLoader(`__ui_kb_load_${sanitizedId(kb.id)}`, kb))
    .join("\n\n");

  // Dispatch table: one entry per input node, in order.
  const dispatchEntries = inputSpecs.map(spec => loaderNameForInput(spec, keyboards));
  const keyboardDispatch = dispatchEntries.length > 0
    ? `void (*__ui_kb_loaders[])() = { ${dispatchEntries.join(", ")} };\nconst uint8_t __ui_kb_loader_count = ${dispatchEntries.length};`
    : `void (*__ui_kb_loaders[])() = {};\nconst uint8_t __ui_kb_loader_count = 0;`;

  return { nodeTable, transitionTable, typeDecl, keyboardLoaders, keyboardDispatch };
}
```

- [ ] **Step 4: Thread keyboards through the registry + emitter**

In `packages/cuttlefish/src/ui/ui-registry.ts`:

1. Update the call site in `lowerOnMount` to pass the module's keyboards. First, `UIModule` must carry them. Update `loadUIModule` to parse with `parseHtmlWithKeyboards` and store:

```typescript
import { parseHtmlWithKeyboards } from "./html-parser.js";
import type { KeyboardTemplate } from "./html-parser.js";

export interface UIModule {
  htmlPath: string;
  styled: StyledNode;
  keyboards: KeyboardTemplate[];
}
```

In `loadUIModule`, replace `const tree = parseHtml(htmlText);` with:

```typescript
  const parsed = parseHtmlWithKeyboards(htmlText);
  const tree = parsed.tree;
  const keyboards = parsed.keyboards;
```

And update the `mod` object:

```typescript
  const mod: UIModule = { htmlPath: abs, styled, keyboards };
```

2. In `lowerOnMount`, pass `mod.keyboards` to `lowerUIToCpp`:

```typescript
  const result = lowerUIToCpp(mod.styled, boxes, opts.colorFormat, opts.storage, mod.keyboards);
```

- [ ] **Step 5: Emit the loader functions + dispatch in the UI emitter**

In `packages/cuttlefish/src/emit/emitters/ui-emitter.ts`, after the node/transition tables are pushed (section 2), add:

```typescript
  // 2b. Keyboard loader functions + dispatch table (for <input> support).
  for (const { lowered } of allLoweredUIModules()) {
    if (lowered.keyboardLoaders) ctx.sourceLines.push(lowered.keyboardLoaders);
    if (lowered.keyboardDispatch) ctx.sourceLines.push(lowered.keyboardDispatch);
  }
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npx vitest run tests/packages/cuttlefish/ui-lowering.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/cuttlefish/src/ir/transformers/ui-lowering.ts packages/cuttlefish/src/ui/ui-registry.ts packages/cuttlefish/src/emit/emitters/ui-emitter.ts tests/packages/cuttlefish/ui-lowering.test.ts
git commit -m "feat(ui): emit keyboard loader functions + dispatch table"
```

---

## Task 11: `.text` read/write IR lowering

**Files:**
- Modify: `packages/cuttlefish/src/ir/expression-to-ir.ts`
- Modify: `packages/cuttlefish/src/ir/statement-to-ir.ts`
- Modify: `packages/cuttlefish/src/ir/transformers/ui-call-resolver.ts`

- [ ] **Step 1: Extend the element-value resolver to track inputs**

In `packages/cuttlefish/src/ir/transformers/ui-call-resolver.ts`, find where `registerElementValue` / `elementValueMap` is defined. Inputs need the same `"treeName.elemId" → nodeIdx` mapping (the `.text` access uses the same resolution as `.value`). Since inputs are registered as nodes like every other element, `registerElementValue` already covers them — verify by checking `build-ir.ts` collects input ids (it walks the styled tree; inputs have ids). No change needed if inputs are already registered.

If inputs are NOT auto-registered (the build-ir walk filters by tag), add `"input"` to whatever tag filter exists. Check `build-ir.ts`:

```bash
grep -n "radio\|progress\|range\|registerElementValue" packages/cuttlefish/src/ir/build-ir.ts
```

If there's a tag whitelist for element registration, add `"input"`.

- [ ] **Step 2: Add `.text` read to expression-to-ir**

In `packages/cuttlefish/src/ir/expression-to-ir.ts`, find the `.value` read block (around line 944, and the duplicate around line 1658). Add a parallel `.text` block right after each `.value` block:

```typescript
    // ---- UI element .text read: screen.ssid.text → __ui_nodes[N].textBuffer ----
    if (
      ts.isPropertyAccessExpression(expr.expression) &&
      expr.expression.name.text === "text" &&
      ts.isPropertyAccessExpression(expr.expression.expression) &&
      ts.isIdentifier(expr.expression.expression.expression)
    ) {
      const treeName = expr.expression.expression.expression.text;
      const elemId = expr.expression.expression.name.text;
      const nodeIdx = resolveElementValue(treeName, elemId);
      if (nodeIdx !== undefined) {
        return { kind: "raw", value: `__ui_nodes[${nodeIdx}].textBuffer` };
      }
    }
```

Apply this to **both** the line-944 block and the line-1658 block (they're in two visitor paths — CallExpression and another context).

- [ ] **Step 3: Add `.text` write to statement-to-ir**

In `packages/cuttlefish/src/ir/statement-to-ir.ts`, find the `.value` write block (around line 159-182). Add a parallel `.text` block right after it (before `const loweredExpression =`). Match the exact return shape — an array with a single object of `kind: "call"`:

```typescript
    // ── UI element .text write: screen.ssid.text = "x" ──────────────────
    // Lowers to strncpy(__ui_nodes[N].textBuffer, "x", UI_TEXT_BUF-1);
    //         __ui_nodes[N].textBuffer[UI_TEXT_BUF-1] = 0; ui_mark_dirty(N);
    if (
      ts.isBinaryExpression(statement.expression) &&
      statement.expression.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      ts.isPropertyAccessExpression(statement.expression.left) &&
      statement.expression.left.name.text === "text" &&
      ts.isPropertyAccessExpression(statement.expression.left.expression) &&
      ts.isIdentifier(statement.expression.left.expression.expression)
    ) {
      const treeName = statement.expression.left.expression.expression.text;
      const elemId = statement.expression.left.expression.name.text;
      const nodeIdx = resolveElementValue(treeName, elemId);
      if (nodeIdx !== undefined) {
        const valIR = expressionToIR(statement.expression.right, sourceText, diagnostics, pointerVars);
        const valText = renderExprAsText(valIR);
        return [{
          kind: "call" as const,
          sourceSpan: makeSourceSpan(statement, fileName, sourceText),
          callee: `__RAW_STMT__strncpy(__ui_nodes[${nodeIdx}].textBuffer, ${valText}, UI_TEXT_BUF - 1); __ui_nodes[${nodeIdx}].textBuffer[UI_TEXT_BUF - 1] = 0; ui_mark_dirty(${nodeIdx});`,
          args: [],
        }];
      }
    }
```

The identifiers `ts`, `expressionToIR`, `renderExprAsText`, `makeSourceSpan`, `fileName`, `sourceText`, `diagnostics`, `pointerVars`, and `resolveElementValue` are all already in scope (they're used by the `.value` block directly above — copy the exact same context).

- [ ] **Step 4: Build cuttlefish and verify it compiles**

Run: `cd packages/cuttlefish && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add packages/cuttlefish/src/ir/expression-to-ir.ts packages/cuttlefish/src/ir/statement-to-ir.ts packages/cuttlefish/src/ir/build-ir.ts
git commit -m "feat(ui): lower screen.input.text read/write to textBuffer"
```

---

## Task 12: Add `InputElement` type + wire `.d.ts` generation

**Files:**
- Modify: `packages/ui/src/types.ts`
- Modify: `packages/ui/src/index.ts`
- Modify: `packages/cuttlefish/src/ui/ui-registry.ts`

- [ ] **Step 1: Add `InputElement` to the UI types**

In `packages/ui/src/types.ts`, add (after `RangeElement`):

```typescript
/** A text input. .text is the string value; tap opens the on-screen keyboard. */
export interface InputElement extends UIElement {
  readonly __kind: "input";
  /** The current text value. Reading returns the string; writing updates the display. */
  text: string;
  /** Fires when the text changes (after the keyboard commits). */
  onChange(callback?: () => void): void;
}
```

Update the `ScreenTree` index signature to include `InputElement`:

```typescript
export interface ScreenTree {
  [id: string]: TextElement | ButtonElement | ViewElement | CheckElement | SelectElement | RadioElement | ProgressElement | RangeElement | InputElement;
}
```

- [ ] **Step 2: Export `InputElement` from the UI package index**

In `packages/ui/src/index.ts`, update the type re-export to include `InputElement`:

```typescript
export type { ScreenTree, TextElement, ButtonElement, ViewElement, PressBinding, CheckElement, SelectElement, RadioElement, ProgressElement, RangeElement, InputElement } from "./types";
```

- [ ] **Step 3: Update `.d.ts` generation to emit InputElement imports**

In `packages/cuttlefish/src/ui/ui-registry.ts`, the `writeTypeDeclSibling` function emits a `.ui.html.d.ts`. It currently imports a fixed subset of element types. Update the import line to include `InputElement`:

```typescript
  const dts = [
    `// Auto-generated by cuttlefish (UI lowering). Do not edit.`,
    `import type { TextElement, ButtonElement, ViewElement, CheckElement, SelectElement, RadioElement, ProgressElement, RangeElement, InputElement } from "@typecad/ui";`,
    `export interface ScreenTree {`,
    fields,
    `}`,
    ``,
    `export const screen: ScreenTree;`,
  ].join("\n");
```

- [ ] **Step 4: Build the UI package and verify**

Run: `cd packages/ui && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/types.ts packages/ui/src/index.ts packages/cuttlefish/src/ui/ui-registry.ts
git commit -m "feat(ui): InputElement type + .d.ts generation for inputs"
```

---

## Task 13: Update `ui-emitter` for NODE_INPUT draw case + onChange handlers

**Files:**
- Modify: `packages/cuttlefish/src/ui/runtime-header.ts` (NODE_INPUT draw case)
- Modify: `packages/cuttlefish/src/emit/emitters/ui-emitter.ts` (onChange handler emission)
- Test: `tests/packages/cuttlefish/runtime-header.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `tests/packages/cuttlefish/runtime-header.test.ts`:

```typescript
  it("draws NODE_INPUT as a bordered field showing textBuffer", () => {
    expect(header).toMatch(/case\s+NODE_INPUT:/);
    expect(header).toMatch(/NODE_INPUT[\s\S]*drawRect/);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/packages/cuttlefish/runtime-header.test.ts`
Expected: FAIL — no `NODE_INPUT` case in the draw switch.

- [ ] **Step 3: Add the NODE_INPUT draw case**

In `packages/cuttlefish/src/ui/runtime-header.ts`, find the draw dispatch `switch` on `__ui_nodes[i].kind`. After the `NODE_RANGE` case (before the closing `}` of the switch), add:

```typescript
      case NODE_INPUT:
        // Input field: bordered rect + current text (or placeholder).
        {
          int16_t bx = __ui_nodes[i].box.x;
          int16_t by = drawY;
          int16_t bw = __ui_nodes[i].box.w;
          int16_t bh = __ui_nodes[i].box.h;
          uint16_t fgCol = __ui_nodes[i].fg;
          uint16_t bgCol = __ui_nodes[i].hasBg ? __ui_nodes[i].bg : __ui_nodes[i].clearColor;
          __tc_display.fillRect(bx, by, bw, bh, bgCol);
          __tc_display.drawRect(bx, by, bw, bh, fgCol);
          // Show textBuffer content (or the static text/placeholder).
          const char* disp = (__ui_nodes[i].textBuffer[0] != 0)
            ? __ui_nodes[i].textBuffer
            : (__ui_nodes[i].text ? __ui_nodes[i].text : "");
          __tc_display.setCursor(bx + 4, by + (bh - 16) / 2);
          __tc_display.setTextColor(fgCol, bgCol);
          __tc_display.setTextSize(2);
          __tc_display.print(disp);
        }
        break;
```

- [ ] **Step 4: Wire onChange handler emission**

The existing `onChange` for check/select/radio uses the click handler table. For inputs, `onChange` fires after `ui_kb_close`. The emitter already builds `__ui_click_handlers[]` from `clickHandlers()`. Inputs need their `onChange` wired into `__ui_kb_onchange` instead.

In `packages/cuttlefish/src/emit/emitters/ui-emitter.ts`, find where `uiPressBindings()` / `clickHandlers()` are emitted (section 8). Add, after the click handler tables:

```typescript
  // 8b. Input onChange handlers — assigned to __ui_kb_onchange at open time.
  // Each input's onChange callback is a function; ui_kb_open sets the global
  // before showing. We emit one function per input with an onChange, and a
  // dispatch that picks the right one based on __ui_kb_target.
  const inputHandlers = clickHandlers().filter(h => h.kind === "change");
  if (inputHandlers.length > 0) {
    for (const h of inputHandlers) {
      ctx.sourceLines.push(`void ${h.fnName}() { ${h.callbackBody || ""} }`);
    }
    // Dispatch: called from ui_kb_open to set __ui_kb_onchange.
    ctx.sourceLines.push(`void __ui_kb_set_onchange() {`);
    ctx.sourceLines.push(`  __ui_kb_onchange = nullptr;`);
    for (const h of inputHandlers) {
      ctx.sourceLines.push(`  if (__ui_kb_target == ${h.nodeIndex}) __ui_kb_onchange = ${h.fnName};`);
    }
    ctx.sourceLines.push(`}`);
  } else {
    ctx.sourceLines.push(`void __ui_kb_set_onchange() { __ui_kb_onchange = nullptr; }`);
  }
```

Then in `ui_kb_open` (runtime-header.ts), call the dispatcher right before `ui_kb_compute_box()`:

```typescript
  extern void __ui_kb_set_onchange();
  __ui_kb_set_onchange();
  ui_kb_compute_box();
```

(The `extern` declaration lets the static inline reference the emitter-generated function. Place the `extern` at file scope near the other keyboard externs, not inside the function — move it up next to `extern void (*__ui_kb_loaders[])();`.)

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/packages/cuttlefish/runtime-header.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/cuttlefish/src/ui/runtime-header.ts packages/cuttlefish/src/emit/emitters/ui-emitter.ts tests/packages/cuttlefish/runtime-header.test.ts
git commit -m "feat(ui): NODE_INPUT draw case + onChange dispatch"
```

---

## Task 14: Keyboard key actions (insert/shift/page/ok) in runtime

**Files:**
- Modify: `packages/cuttlefish/src/ui/runtime-header.ts`
- Test: `tests/packages/cuttlefish/runtime-header.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `tests/packages/cuttlefish/runtime-header.test.ts`:

```typescript
  it("keyboard key actions: insert, shift toggle, page-swap, ok close", () => {
    expect(header).toContain("ui_kb_insert");
    expect(header).toMatch(/special\s*==\s*1[\s\S]*__ui_kb_shift/);
    expect(header).toMatch(/special\s*==\s*3[\s\S]*ui_kb_close/);
    expect(header).toMatch(/special\s*==\s*4[\s\S]*__ui_kb_load/);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/packages/cuttlefish/runtime-header.test.ts`
Expected: FAIL — key actions not implemented (only insert/delete/open/close stubs exist).

- [ ] **Step 3: Implement key actions on tap (touch-up)**

The hit-test in `ui_kb_handle_touch` (Task 7) only handled backspace on touch-down. Key actions for char/shift/page/ok should fire on **touch-up** (tap), while backspace hold-repeat fires during touch-down. Extend the keyboard handling.

In `packages/cuttlefish/src/ui/runtime-header.ts`, add a `ui_kb_handle_tap` function (fires on touch-up inside a key) after `ui_kb_handle_touch`:

```typescript

// Handle a tap (touch-up) on a keyboard key. tx,ty are display coords.
static inline void ui_kb_handle_tap(int16_t tx, int16_t ty) {
  for (uint8_t i = 0; i < __ui_kb_keyCount; i++) {
    UIRect r;
    ui_kb_key_rect(i, &r);
    if (tx >= r.x && tx < r.x + r.w && ty >= r.y && ty < r.y + r.h) {
      UIKey k = __ui_kb_keys[i];
      switch (k.special) {
        case 0: {  // char
          char c = k.ch;
          if (__ui_kb_shift && c >= 'a' && c <= 'z') c -= 32;
          ui_kb_insert(c);
          __ui_kb_shift = 0;  // shift resets after one char
          break;
        }
        case 1:  // shift toggle
          __ui_kb_shift = !__ui_kb_shift;
          break;
        case 2:  // backspace: handled on down + repeat; nothing on tap-up
          break;
        case 3:  // OK
          ui_kb_close();
          break;
        case 4:  // page-swap (123 → symbols, ABC → alpha)
          // Swap to the alternate keyboard by calling the other default loader.
          // For v1, 123 toggles to a symbol page stored inline; ABC toggles back
          // to alpha. The loaders are extern; call the opposite of current.
          // Simple v1: swap between default_alpha and default_number.
          {
            extern void __ui_kb_load_default_alpha();
            extern void __ui_kb_load_default_number();
            if (__ui_kb_cols <= 4) __ui_kb_load_default_alpha();
            else __ui_kb_load_default_number();
            ui_kb_compute_box();
          }
          break;
      }
      return;
    }
  }
}
```

Now route touch-up to it. In `ui_touch_up` (the function handling touch release), add a modal guard at the top:

```typescript
static void ui_touch_up() {
  // Modal keyboard: route tap-up to the keyboard.
  if (__ui_kb_visible) {
    // Use the last known touch coords (stored by ui_handle_touch). For v1,
    // re-derive from __ui_drag_start_x/y if available, or skip — the tap
    // position is the down position for a quick tap.
    // The runtime stores the last touch in __ui_last_touch_x / __ui_last_touch_y.
    ui_kb_handle_tap(__ui_last_touch_x, __ui_last_touch_y);
    __ui_kb_bs_held = 0;
    __ui_touch_state = 0;
    return;
  }
  // ... existing touch-up logic ...
```

This requires the runtime to track `__ui_last_touch_x` / `__ui_last_touch_y`. In `ui_handle_touch`, store them at the top:

```typescript
static inline void ui_handle_touch(int16_t tx, int16_t ty) {
  __ui_last_touch_x = tx;
  __ui_last_touch_y = ty;
  // ... modal guard + existing logic ...
```

And declare the globals near the other touch state:

```typescript
static int16_t __ui_last_touch_x = 0;
static int16_t __ui_last_touch_y = 0;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/packages/cuttlefish/runtime-header.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/cuttlefish/src/ui/runtime-header.ts tests/packages/cuttlefish/runtime-header.test.ts
git commit -m "feat(ui): keyboard key actions — insert, shift, page-swap, ok"
```

---

## Task 15: Add `<input>` fields to the demo

**Files:**
- Modify: `demo-ui/src/hello.ui.html`
- Modify: `demo-ui/src/main.ts`

- [ ] **Step 1: Add input fields to the demo HTML**

In `demo-ui/src/hello.ui.html`, add input fields inside the `<view id="body">`, after the range row:

```html
    <view id="inputRow">
      <label for="ssid">SSID:</label>
      <input id="ssid" type="text" placeholder="Network" maxlength="32"></input>
    </view>

    <view id="portRow">
      <label for="port">Port:</label>
      <input id="port" type="number" placeholder="8080" maxlength="5"></input>
    </view>
```

- [ ] **Step 2: Add demo styling**

In `demo-ui/src/hello.ui.css`, add:

```css
#inputRow, #portRow {
  display: flex;
  flex-direction: row;
  align-items: center;
  align-self: center;
  gap: 8px;
}

#inputRow label, #portRow label {
  color: lightslategray;
  font-size: 16px;
}

#ssid, #port {
  color: lightskyblue;
  border: 1px solid lightslategray;
  padding: 4px 8px;
}
```

- [ ] **Step 3: Wire up the demo TS**

In `demo-ui/src/main.ts`, add at the end:

```typescript
// <input>: tap to open the on-screen keyboard. Read .text for the value.
screen.ssid.onChange(() => {
  console.log("ssid:", screen.ssid.text);
});
screen.port.onChange(() => {
  console.log("port:", screen.port.text);
});
```

- [ ] **Step 4: Build the demo and verify it transpiles**

Run: `cd demo-ui && npm run build`
Expected: ✓ Done, no errors. The `.ui.html.d.ts` should now include `ssid: InputElement` and `port: InputElement`.

- [ ] **Step 5: Verify the generated C++ contains the keyboard subsystem**

Run (from the demo-ui dir): `grep -c "ui_kb_" src/out/main/main.ino`
Expected: a positive count (keyboard symbols present).

Run: `grep "NODE_INPUT" src/out/main/main.ino`
Expected: at least one match (the input node in the table).

- [ ] **Step 6: Upload to hardware and verify**

Run: `cd demo-ui && npm run upload`
Expected: compiles + flashes successfully.

Manual hardware check: tap the SSID field → alpha keyboard opens → type a string → OK → field shows the string. Tap the Port field → numeric keyboard opens.

- [ ] **Step 7: Commit**

```bash
git add demo-ui/src/hello.ui.html demo-ui/src/hello.ui.css demo-ui/src/main.ts
git commit -m "demo: add <input> fields for SSID and port"
```

---

## Task 16: Final verification — full test suite + build

- [ ] **Step 1: Build all packages**

Run: `cd packages/cuttlefish && npm run build && cd ../ui && npm run build && cd ../framework-arduino && npm run build`
Expected: all three build clean.

- [ ] **Step 2: Run the cuttlefish test suite**

Run: `npx vitest run tests/packages/cuttlefish/`
Expected: all pass (including the new keyboard/input tests).

- [ ] **Step 3: Run the full root test suite**

Run: `npx vitest run tests/`
Expected: no new failures beyond the 2 known pre-existing failures (`ili9341.test.ts` backlight pinMode, `init-scaffold.test.ts` d.ts — both unrelated to this work, confirmed pre-existing via `git stash`).

- [ ] **Step 4: Verify the demo end-to-end on hardware**

Re-upload if needed and confirm:
- Tapping an input opens the keyboard (alpha for text, numeric for number)
- Typing inserts chars; shift capitalizes one letter
- ⌫ tap deletes one; ⌫ hold auto-repeats
- OK commits and closes; the field shows the typed string
- `console.log` fires with the new `.text` value

- [ ] **Step 5: Commit any final fixes**

```bash
git add -A
git commit -m "feat(ui): text input & on-screen keyboard — complete"
```

---

## Self-Review Notes

**Spec coverage check (spec section → task):**
- §2 Authoring (`<input>`, `<keyboard>`, `.text`, `onChange`) → Tasks 1, 2, 11, 12, 15
- §3 Default keyboards (alpha + numeric) → Task 3
- §4 Transpile lowering (NODE_INPUT, loaders, dispatch, `.text` access, maxlen) → Tasks 5, 10, 11
- §5 Runtime architecture (UIKey, globals, open/close, draw, modal) → Tasks 6, 7, 8, 9
- §6 Behavior (insert/shift/page/ok/⌫ hold-repeat) → Tasks 7, 14
- §7 CSS styling → partially covered (Task 13 emits key colors from default style; full `<key class>` CSS resolution is a follow-up — the defaults bake in styling)
- §8 Files → all touched
- §9 Testing → each task has TDD tests; Task 16 runs the full suite

**Known simplification for v1 (vs. spec):**
- CSS styling of individual keys via `<key class>` is deferred — the defaults use baked-in colors (Task 13). The spec's `UIKeyStyle` parallel array is a follow-up once the core works. The infrastructure (template parsing in Task 2, loader emission in Task 10) is in place; only per-key style resolution is deferred.
- Page-swap (123/ABC) swaps between the two default loaders rather than a separate symbol page (Task 14). This is the simplest v1; a dedicated symbol page is a follow-up.

**Type consistency:**
- `InputElement` defined in Task 12, used in `.d.ts` (Task 12) and demo (Task 15) ✓
- `maxlen` field added consistently: model (Task 4), node table (Task 5), runtime struct (Task 6) ✓
- `NODE_INPUT` enum value: runtime (Task 6), draw case (Task 13) ✓
- `lowerUIToCpp` signature extended with `keyboards` param (Task 10) — all call sites updated ✓
