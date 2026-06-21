# UI Text Binding Fix (Dynamic Text) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `ui.bind(node, 'text', fn)` work — dynamic text (counters, signal-derived strings) updates on screen each tick instead of being silently broken.

**Architecture:** Each `UINode` gains a mutable `char textBuffer[UI_TEXT_BUF]` (UI_TEXT_BUF=16) plus a `hasTextBinding` flag. The `textFn` signature changes from `const char* textFn(void)` to `void textFn(char* buf, uint8_t size)` — it writes directly into the node's buffer. The dispatch compares by content (`strcmp`), not pointer. The transpiler recognizes three arrow-body shapes (`String(numeric)`, bare string literal, template literal) and lowers each to a `snprintf` statement; anything else emits a warning + safe no-op.

**Tech Stack:** TypeScript (transpiler), C++ (emitted runtime), vitest (tests).

**Spec:** `docs/superpowers/specs/2026-06-21-ui-text-binding-design.md`

---

## File Structure

Six source files change, two test files change, one test file is new:

| File | Responsibility | Change |
|------|----------------|--------|
| `packages/cuttlefish/src/ui/runtime-header.ts` | C++ runtime header (structs + driver) | Add `UI_TEXT_BUF`, `textBuffer`/`hasTextBinding` fields, new `textFn` sig, `ui_init` seeding, `strcmp` dispatch, `displayText` local |
| `packages/cuttlefish/src/ir/transformers/ui-reactive.ts` | BindingSpec + table entry emitter | Add `cppBody?` to `BindingSpec` |
| `packages/cuttlefish/src/ir/transformers/ui-call-resolver.ts` | Lowers `ui.*` calls to IR | Add `signalCppType()`, add `lowerTextBindingBody()`, branch text bindings in `resolveBindCall` |
| `packages/cuttlefish/src/emit/emitters/ui-emitter.ts` | Injects runtime + tables into entry TU | Emit `void textFn(...)` from `cppBody`; push `<stdio.h>` |
| `packages/cuttlefish/src/ir/transformers/ui-lowering.ts` | Builds node table from styled tree | Zero-init `textBuffer`/`hasTextBinding` in initializer |
| `demo-ui/src/main.ts` | Demo app | Add counter text binding |
| `tests/packages/cuttlefish/runtime-header.test.ts` | Runtime-header assertions | Add field/dispatch/seed assertions |
| `tests/packages/cuttlefish/ui-reactive.test.ts` | BindingSpec/table assertions | Add `cppBody` entry assertion |
| `tests/packages/cuttlefish/text-binding-lowering.test.ts` (NEW) | `lowerTextBindingBody` coverage | The three shapes + fallback |
| `tests/packages/cuttlefish/ui-e2e.test.ts` | E2E emitted-TU assertions | Add text-binding function + `<stdio.h>` |

**Build/test commands** (from repo root):
- Run a single test file: `npm vitest run tests/packages/cuttlefish/<file>.test.ts --reporter=verbose`
- Run all cuttlefish tests: `npm vitest run tests/packages/cuttlefish/`
- Rebuild packages after source edits (required before CLI picks up changes): `npm run build --workspace @typehal/core && npm run build --workspace @typehal/framework-arduino && npm run build --workspace @typehal/transpiler`

The cuttlefish package is consumed via its source by the test suite (the test imports `../../../packages/cuttlefish/src/...` directly — see `tests/packages/cuttlefish/ui-call-lowering.test.ts:19`), so source edits to `packages/cuttlefish/src/` are picked up by `vitest run` without a rebuild. A rebuild is only needed to exercise the CLI/demo end-to-end.

---

## Task 1: Add `UI_TEXT_BUF` constant + `UINode` fields + new `textFn` signature

This task changes the C++ struct shapes. It is the foundation every later task depends on. Tests assert on the emitted header text.

**Files:**
- Modify: `packages/cuttlefish/src/ui/runtime-header.ts` (lines 17–62 region)
- Test: `tests/packages/cuttlefish/runtime-header.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `tests/packages/cuttlefish/runtime-header.test.ts`, inside the existing `describe` block, after the last `it(...)`:

```typescript
  it("defines UI_TEXT_BUF as 16", () => {
    expect(header).toMatch(/#define\s+UI_TEXT_BUF\s+16/);
  });

  it("UINode has a mutable textBuffer and hasTextBinding field", () => {
    expect(header).toMatch(/char\s+textBuffer\[UI_TEXT_BUF\]/);
    expect(header).toMatch(/uint8_t\s+hasTextBinding/);
  });

  it("UIBinding textFn signature is void fill-style (char*, uint8_t)", () => {
    expect(header).toMatch(/void\s+\(\*textFn\)\(char\*\s*buf,\s*uint8_t\s*size\)/);
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm vitest run tests/packages/cuttlefish/runtime-header.test.ts --reporter=verbose`
Expected: 3 FAIL (no `UI_TEXT_BUF`, no `textBuffer`, old `textFn` signature).

- [ ] **Step 3: Implement — add the constant and fields**

In `packages/cuttlefish/src/ui/runtime-header.ts`, find the line `#include <stdint.h>` (line 20) and add immediately after it:

```cpp
#define UI_TEXT_BUF 16   // single source of truth: UINode field + textFn size arg + snprintf bound
```

Then in the `UINode` struct, find the `const char* text;` line (line 31) and add the two new fields right after it:

```cpp
  const char* text;
  char textBuffer[UI_TEXT_BUF]; // dynamic text — read only when hasTextBinding == 1
  uint8_t hasTextBinding;       // set by ui_init when a PROP_TEXT binding targets this node
```

Then in the `UIBinding` struct, replace the `textFn` line (line 61):

```cpp
// was:
//   const char* (*textFn)(void); // for text bindings (PROP_TEXT)
// now:
  void (*textFn)(char* buf, uint8_t size); // for text bindings (PROP_TEXT): fills buf
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm vitest run tests/packages/cuttlefish/runtime-header.test.ts --reporter=verbose`
Expected: all PASS (the original 7 + the 3 new).

- [ ] **Step 5: Commit**

```bash
git add packages/cuttlefish/src/ui/runtime-header.ts tests/packages/cuttlefish/runtime-header.test.ts
git commit -m "feat(ui): UINode textBuffer + fill-style textFn signature"
```

---

## Task 2: `ui_init` seeds text buffers from flash literals

Seeds every PROP_TEXT binding's node buffer at startup so the first `strcmp` in `ui_tick` has a valid baseline.

**Files:**
- Modify: `packages/cuttlefish/src/ui/runtime-header.ts` (the `ui_init` function, lines 91–95)
- Test: `tests/packages/cuttlefish/runtime-header.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `tests/packages/cuttlefish/runtime-header.test.ts`:

```typescript
  it("ui_init seeds textBuffer from the flash literal for PROP_TEXT bindings", () => {
    // ui_init must: set hasTextBinding=1, strncpy text→textBuffer, NUL-terminate.
    expect(header).toMatch(/ui_init[\s\S]*hasTextBinding\s*=\s*1/);
    expect(header).toMatch(/ui_init[\s\S]*strncpy\(\s*__ui_nodes\[n\]\.textBuffer,\s*__ui_nodes\[n\]\.text,\s*UI_TEXT_BUF\s*-\s*1\s*\)/);
    expect(header).toMatch(/ui_init[\s\S]*textBuffer\[UI_TEXT_BUF\s*-\s*1\]\s*=\s*'\\0'/);
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm vitest run tests/packages/cuttlefish/runtime-header.test.ts --reporter=verbose`
Expected: 1 FAIL (the current `ui_init` only sets `dirty`).

- [ ] **Step 3: Implement — extend `ui_init`**

In `packages/cuttlefish/src/ui/runtime-header.ts`, replace the entire `ui_init` function (lines 91–95):

```cpp
// was:
// static inline void ui_init(void) {
//   for (uint8_t i = 0; i < __ui_node_count; i++) {
//     __ui_nodes[i].dirty = 1;
//   }
// }
// now:
// Initial draw: mark all nodes dirty so the first ui_tick renders everything.
// Also seed each text-bound node's buffer from its flash literal so the first
// strcmp in ui_tick has a valid baseline (no spurious redraw on frame 1).
static inline void ui_init(void) {
  for (uint8_t i = 0; i < __ui_node_count; i++) {
    __ui_nodes[i].dirty = 1;
  }
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

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm vitest run tests/packages/cuttlefish/runtime-header.test.ts --reporter=verbose`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/cuttlefish/src/ui/runtime-header.ts tests/packages/cuttlefish/runtime-header.test.ts
git commit -m "feat(ui): ui_init seeds textBuffer from flash literal for text bindings"
```

---

## Task 3: Switch the binding dispatch to save/compare/`strcmp`

Replaces the broken pointer-comparison dispatch (Level 3) with content comparison. This is the core runtime fix.

**Files:**
- Modify: `packages/cuttlefish/src/ui/runtime-header.ts` (lines 172–178, the `PROP_TEXT` branch of the binding loop in `ui_tick`)
- Test: `tests/packages/cuttlefish/runtime-header.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `tests/packages/cuttlefish/runtime-header.test.ts`:

```typescript
  it("ui_tick text-binding dispatch compares by content (strcmp), not pointer", () => {
    // Must: save oldBuf, call textFn(buf,size), strcmp to decide dirty.
    expect(header).toMatch(/char\s+oldBuf\[UI_TEXT_BUF\]/);
    expect(header).toMatch(/strcpy\(\s*oldBuf,\s*__ui_nodes\[.*?\]\.textBuffer\s*\)/);
    expect(header).toMatch(/textFn\(\s*__ui_nodes\[.*?\]\.textBuffer,\s*UI_TEXT_BUF\s*\)/);
    expect(header).toMatch(/strcmp\(\s*oldBuf,\s*__ui_nodes\[.*?\]\.textBuffer\s*\)\s*!=\s*0/);
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm vitest run tests/packages/cuttlefish/runtime-header.test.ts --reporter=verbose`
Expected: 1 FAIL (current dispatch uses `newText != ...text` pointer compare).

- [ ] **Step 3: Implement — replace the dispatch**

In `packages/cuttlefish/src/ui/runtime-header.ts`, find the `PROP_TEXT` branch inside `ui_tick` (lines 172–178):

```cpp
    if (__ui_bindings[i].prop == PROP_TEXT && __ui_bindings[i].textFn) {
      // Text binding: compare string pointers (re-render if changed)
      const char* newText = __ui_bindings[i].textFn();
      if (newText != __ui_nodes[__ui_bindings[i].node].text) {
        __ui_nodes[__ui_bindings[i].node].text = newText;
        ui_mark_dirty(__ui_bindings[i].node);
      }
    } else if (__ui_bindings[i].fn) {
```

Replace it with:

```cpp
    if (__ui_bindings[i].prop == PROP_TEXT && __ui_bindings[i].textFn) {
      // Text binding: fill the node's buffer, compare content, mark dirty if changed.
      uint8_t n = __ui_bindings[i].node;
      char oldBuf[UI_TEXT_BUF];
      strcpy(oldBuf, __ui_nodes[n].textBuffer);
      __ui_bindings[i].textFn(__ui_nodes[n].textBuffer, UI_TEXT_BUF);
      if (strcmp(oldBuf, __ui_nodes[n].textBuffer) != 0) {
        ui_mark_dirty(n);
      }
    } else if (__ui_bindings[i].fn) {
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm vitest run tests/packages/cuttlefish/runtime-header.test.ts --reporter=verbose`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/cuttlefish/src/ui/runtime-header.ts tests/packages/cuttlefish/runtime-header.test.ts
git commit -m "feat(ui): text-binding dispatch compares by content via strcmp"
```

---

## Task 4: Draw dispatch reads `textBuffer` when `hasTextBinding`

The draw code currently reads `__ui_nodes[i].text` in three places (text-width measurement, `print()`, underline width). Switch to a `displayText` local that selects the source by `hasTextBinding`.

**Files:**
- Modify: `packages/cuttlefish/src/ui/runtime-header.ts` (lines 206–255 region of the draw loop in `ui_tick`)
- Test: `tests/packages/cuttlefish/runtime-header.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `tests/packages/cuttlefish/runtime-header.test.ts`:

```typescript
  it("draw dispatch selects displayText by hasTextBinding (textBuffer vs text)", () => {
    // The dirty-node loop must declare a displayText local and read from it.
    expect(header).toMatch(/const char\*\s+displayText\s*=\s*__ui_nodes\[i\]\.hasTextBinding\s*\?\s*__ui_nodes\[i\]\.textBuffer\s*:\s*__ui_nodes\[i\]\.text/);
    // And the print() call site must use displayText, not __ui_nodes[i].text.
    expect(header).toMatch(/__tc_display\.print\(\s*displayText\s*\)/);
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm vitest run tests/packages/cuttlefish/runtime-header.test.ts --reporter=verbose`
Expected: 1 FAIL (no `displayText` local; `print` reads `__ui_nodes[i].text`).

- [ ] **Step 3: Implement — add `displayText` and rewire three call sites**

In `packages/cuttlefish/src/ui/runtime-header.ts`, find the dirty-node draw loop. It currently begins (around line 202–208):

```cpp
  for (uint8_t i = 0; i < __ui_node_count; i++) {
    if (!__ui_nodes[i].dirty) continue;
    if (!__ui_nodes[i].visible) continue;  // visibility: hidden → skip entirely
    // Compute text width helper (used by text-align and button centering).
    uint16_t tw = 0;
    if (__ui_nodes[i].text) {
      for (const char* p = __ui_nodes[i].text; *p; p++) tw += 12;
    }
```

Replace that opening block (from `// Compute text width helper` through the closing `}` of the `if (__ui_nodes[i].text)` block) with:

```cpp
    // Source selection: text-bound nodes show their dynamic buffer; others show
    // the immutable flash literal.
    const char* displayText = __ui_nodes[i].hasTextBinding
      ? __ui_nodes[i].textBuffer
      : __ui_nodes[i].text;
    // Compute text width helper (used by text-align and button centering).
    uint16_t tw = 0;
    if (displayText) {
      for (const char* p = displayText; *p; p++) tw += 12;
    }
```

Then there are two more `__ui_nodes[i].text` references to change. Find `__tc_display.print(__ui_nodes[i].text);` inside the `NODE_TEXT` case (line 226) and change it to:

```cpp
        __tc_display.print(displayText);
```

Find `__tc_display.print(__ui_nodes[i].text);` inside the `NODE_BUTTON` case (line 255) and change it to:

```cpp
        __tc_display.print(displayText);
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm vitest run tests/packages/cuttlefish/runtime-header.test.ts --reporter=verbose`
Expected: PASS.

- [ ] **Step 5: Verify no stray `__ui_nodes[i].text` reads remain in the draw loop**

Search check (run from repo root):

```bash
git grep -n "__ui_nodes\[i\]\.text" packages/cuttlefish/src/ui/runtime-header.ts
```

Expected: the only matches are in `ui_init` (the `strncpy(... __ui_nodes[n].text ...)` seeding) and in the `displayText` ternary's `: __ui_nodes[i].text` branch. If any other read remains in `ui_tick`'s draw loop, fix it before committing.

- [ ] **Step 6: Commit**

```bash
git add packages/cuttlefish/src/ui/runtime-header.ts tests/packages/cuttlefish/runtime-header.test.ts
git commit -m "feat(ui): draw dispatch reads textBuffer when hasTextBinding is set"
```

---

## Task 5: Zero-init `textBuffer` / `hasTextBinding` in the node-table initializer

The node table is emitted with an aggregate initializer per node. It must include the new fields so the struct is fully initialized before `ui_init` runs.

**Files:**
- Modify: `packages/cuttlefish/src/ir/transformers/ui-lowering.ts` (line 108, the node-table row template)
- Test: `tests/packages/cuttlefish/ui-lowering.test.ts` (existing file — read it first to match conventions)

- [ ] **Step 1: Read the existing test file to match its conventions**

Run: read `tests/packages/cuttlefish/ui-lowering.test.ts` and note how it invokes the lowering and asserts on `nodeTable` substrings. Mirror that for the new assertion.

- [ ] **Step 2: Write the failing test**

Add to `tests/packages/cuttlefish/ui-lowering.test.ts`, inside its top-level `describe`, a new `it(...)`:

```typescript
  it("zero-initializes textBuffer and hasTextBinding in each node row", () => {
    // Lower a minimal tree so we can inspect a node row.
    // (Reuse the existing helper / HTML+CSS fixtures used by sibling tests in
    //  this file; if there is a transpileUI-style helper, call it the same way.)
    // Assert the new fields appear in the emitted aggregate initializer.
    expect(out.nodeTable).toMatch(/\.textBuffer=\{0\}/);
    expect(out.nodeTable).toMatch(/\.hasTextBinding=0/);
  });
```

If the file's existing tests use a different variable name than `out` (e.g. `result`, `lowered`), use that name in the assertion. Match what the surrounding tests use.

- [ ] **Step 3: Run the test to verify it fails**

Run: `npm vitest run tests/packages/cuttlefish/ui-lowering.test.ts --reporter=verbose`
Expected: 1 FAIL (current row template omits the new fields).

- [ ] **Step 4: Implement — extend the row template**

In `packages/cuttlefish/src/ir/transformers/ui-lowering.ts`, find the node-row `return` statement (line 108):

```typescript
    return `  { .box=${box}, .bg=${bgStr}, .fg=${fgStr}, .kind=${kind}, .text=${text}, .font=${font}, .hasBg=${n.hasBg ? 1 : 0}, .textAlign=${textAlign}, .borderColor=${borderColorStr}, .borderStyle=${borderStyle}, .underline=${underline}, .visible=${visible} },`;
```

Add the two new fields immediately after `.text=${text},`:

```typescript
    return `  { .box=${box}, .bg=${bgStr}, .fg=${fgStr}, .kind=${kind}, .text=${text}, .textBuffer={0}, .hasTextBinding=0, .font=${font}, .hasBg=${n.hasBg ? 1 : 0}, .textAlign=${textAlign}, .borderColor=${borderColorStr}, .borderStyle=${borderStyle}, .underline=${underline}, .visible=${visible} },`;
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm vitest run tests/packages/cuttlefish/ui-lowering.test.ts --reporter=verbose`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/cuttlefish/src/ir/transformers/ui-lowering.ts tests/packages/cuttlefish/ui-lowering.test.ts
git commit -m "feat(ui): zero-init textBuffer and hasTextBinding in node-table rows"
```

---

## Task 6: Add `cppBody` to `BindingSpec`

The imperative body for text bindings needs a place to live distinct from `cppExpr` (the color-binding expression). Pure additive change — no existing behavior changes.

**Files:**
- Modify: `packages/cuttlefish/src/ir/transformers/ui-reactive.ts` (the `BindingSpec` interface, lines 13–21)
- Test: `tests/packages/cuttlefish/ui-reactive.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `tests/packages/cuttlefish/ui-reactive.test.ts`, inside the existing `describe`:

```typescript
  it("a text BindingSpec with cppBody still wires .textFn in the table entry", () => {
    const spec: BindingSpec = {
      nodeIndex: 1,
      property: "text",
      fnName: "__ui_bind_text_0",
      cppBody: `snprintf(buf, size, "%d", count);`,
    };
    const entry = emitBindingEntry(spec);
    expect(entry).toContain(".textFn=__ui_bind_text_0");
    expect(entry).toContain("PROP_TEXT");
  });
```

If `BindingSpec` is not already imported at the top of the test file, add it to the existing import from `@typecad/cuttlefish/ir/transformers/ui-reactive` (it is already imported — see line 4 of the file).

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm vitest run tests/packages/cuttlefish/ui-reactive.test.ts --reporter=verbose`
Expected: 1 FAIL — TypeScript error, `cppBody` is not a known property of `BindingSpec`.

- [ ] **Step 3: Implement — add the field**

In `packages/cuttlefish/src/ir/transformers/ui-reactive.ts`, find the `BindingSpec` interface (lines 13–21):

```typescript
export interface BindingSpec {
  nodeIndex: number;
  property: string;
  fnName: string;
  /** The C++ expression for the binding's compute function body (v1: may be
   *  empty if the arrow body couldn't be lowered; the emitter falls back to
   *  returning the node's current value). */
  cppExpr?: string;
}
```

Add a new field after `cppExpr`:

```typescript
export interface BindingSpec {
  nodeIndex: number;
  property: string;
  fnName: string;
  /** The C++ expression for the color-binding compute function (v1: may be
   *  empty if the arrow body couldn't be lowered; the emitter falls back to
   *  returning the node's current value). */
  cppExpr?: string;
  /** The imperative C++ statement body for a text binding (e.g.
   *  `snprintf(buf, size, "%d", count);`). Mutually exclusive with cppExpr:
   *  text bindings use cppBody, color bindings use cppExpr. */
  cppBody?: string;
}
```

Also update the comment on `emitBindingEntry`'s text-binding branch (around lines 42–44) to note the new signature. Find:

```typescript
  // Text bindings wire to textFn; color bindings wire to fn.
```

Replace with:

```typescript
  // Text bindings wire to textFn (void fill-style); color bindings wire to fn.
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm vitest run tests/packages/cuttlefish/ui-reactive.test.ts --reporter=verbose`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/cuttlefish/src/ir/transformers/ui-reactive.ts tests/packages/cuttlefish/ui-reactive.test.ts
git commit -m "feat(ui): BindingSpec gains cppBody for text bindings"
```

---

## Task 7: Add `signalCppType()` accessor

The text-binding lowerer needs to read a signal's recorded C++ type to pick `%d` vs `%g` (spec §5.3). Today only `isSignalName(name)` (boolean) is exported; the cppType is locked inside the module-private `signals` map.

**Files:**
- Modify: `packages/cuttlefish/src/ir/transformers/ui-call-resolver.ts` (add an accessor near `isSignalName`, line 99)
- Test: `tests/packages/cuttlefish/ui-call-lowering.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `tests/packages/cuttlefish/ui-call-lowering.test.ts`. First check the existing imports from `ui-call-resolver` (around line 10–19) and add `signalCppType` to that import list if not present. Then add inside the top-level `describe`:

```typescript
  it("signalCppType returns the recorded cpp type for a signal", () => {
    recordSignal("temp", "int", 22);
    recordSignal("ratio", "float", 1.5);
    expect(signalCppType("temp")).toBe("int");
    expect(signalCppType("ratio")).toBe("float");
    expect(signalCppType("nonexistent")).toBeUndefined();
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm vitest run tests/packages/cuttlefish/ui-call-lowering.test.ts --reporter=verbose`
Expected: 1 FAIL — `signalCppType` is not exported.

- [ ] **Step 3: Implement — add the accessor**

In `packages/cuttlefish/src/ir/transformers/ui-call-resolver.ts`, find `isSignalName` (lines 98–101):

```typescript
/** Is `name` a recorded UI signal? Used to lower `temp()` reads → `temp`. */
export function isSignalName(name: string): boolean {
  return signals.has(name);
}
```

Add immediately after it:

```typescript
/** The recorded C++ type of a signal, or undefined if not a signal.
 *  Used by the text-binding lowerer to pick %d vs %g (spec §5.3). */
export function signalCppType(name: string): string | undefined {
  return signals.get(name)?.cppType;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm vitest run tests/packages/cuttlefish/ui-call-lowering.test.ts --reporter=verbose`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/cuttlefish/src/ir/transformers/ui-call-resolver.ts tests/packages/cuttlefish/ui-call-lowering.test.ts
git commit -m "feat(ui): export signalCppType accessor for the text-binding lowerer"
```

---

## Task 8: Implement `lowerTextBindingBody` — the three shapes + fallback

This is the core of Level 1. A pure function that inspects the arrow-body AST and emits the `snprintf` statement. Tested in isolation.

**Files:**
- Modify: `packages/cuttlefish/src/ir/transformers/ui-call-resolver.ts` (add the helper; export it)
- Test: `tests/packages/cuttlefish/text-binding-lowering.test.ts` (NEW)

- [ ] **Step 1: Write the failing tests (new file)**

Create `tests/packages/cuttlefish/text-binding-lowering.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import ts from "typescript";
import {
  lowerTextBindingBody,
  resetUICallState,
  recordSignal,
} from "../../../packages/cuttlefish/src/ir/transformers/ui-call-resolver";
import type { Diagnostic } from "../../../packages/cuttlefish/src/types";

// Parse a TS arrow body to its Expression AST the way the resolver does.
function bodyOf(arrow: string): ts.Expression {
  const sf = ts.createSourceFile("b.ts", arrow, ts.ScriptTarget.Latest, true);
  const stmt = sf.statements[0];
  if (!stmt || !ts.isExpressionStatement(stmt)) throw new Error("bad arrow");
  const e = stmt.expression;
  if (!ts.isArrowFunction(e) || !ts.isExpression(e.body)) throw new Error("not arrow w/ expr body");
  return e.body as ts.Expression;
}

describe("lowerTextBindingBody", () => {
  let diags: Diagnostic[];

  beforeEach(() => {
    resetUICallState();
    diags = [];
  });

  it("lowers String(<int signal read>) to snprintf %d", () => {
    recordSignal("count", "int", 0);
    const body = bodyOf("() => String(count())");
    const out = lowerTextBindingBody(body, "x.ts", "", diags);
    expect(out.cppBody).toContain('snprintf(buf, size, "%d", count)');
    expect(diags).toHaveLength(0);
  });

  it("lowers String(<float signal read>) to snprintf %g", () => {
    recordSignal("ratio", "float", 1.5);
    const body = bodyOf("() => String(ratio())");
    const out = lowerTextBindingBody(body, "x.ts", "", diags);
    expect(out.cppBody).toContain('snprintf(buf, size, "%g", ratio)');
    expect(diags).toHaveLength(0);
  });

  it("lowers a bare string literal to snprintf %s", () => {
    const body = bodyOf(`() => "idle"`);
    const out = lowerTextBindingBody(body, "x.ts", "", diags);
    expect(out.cppBody).toContain('snprintf(buf, size, "%s", "idle")');
    expect(diags).toHaveLength(0);
  });

  it("lowers a template literal with one numeric interpolation", () => {
    recordSignal("n", "int", 0);
    const body = bodyOf("() => `count: ${n()}`");
    const out = lowerTextBindingBody(body, "x.ts", "", diags);
    expect(out.cppBody).toContain('snprintf(buf, size, "count: %d", n)');
    expect(diags).toHaveLength(0);
  });

  it("falls back to a safe no-op + ui-bind-text-unlowered warning for unknown shapes", () => {
    // An array literal is none of the three shapes.
    const body = bodyOf("() => [1, 2, 3]");
    const out = lowerTextBindingBody(body, "x.ts", "", diags);
    expect(out.cppBody).toBe("buf[0] = 0;");
    expect(diags.some((d) => d.code === "ui-bind-text-unlowered")).toBe(true);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm vitest run tests/packages/cuttlefish/text-binding-lowering.test.ts --reporter=verbose`
Expected: FAIL — `lowerTextBindingBody` is not exported.

- [ ] **Step 3: Implement — add the helper**

In `packages/cuttlefish/src/ir/transformers/ui-call-resolver.ts`, add this import at the top of the file with the other imports (after line 24, the existing `getContext` import):

```typescript
import { escapeCppStringLiteral } from "../../utils/strings.js";
```

(Verify the path by checking the existing import in `packages/cuttlefish/src/ir/render-expr.ts:4` — it imports `escapeCppStringLiteral` from `"../utils/strings.js"`. From `ui-call-resolver.ts`, which lives one directory deeper under `transformers/`, the relative path is `"../../utils/strings.js"`.)

Then add the helper function. Place it just before `resolveBindCall` (before line 311):

```typescript
// ── Text-binding lowering (spec §5) ──────────────────────────────────────────

/** Result of lowering a text-binding arrow body. */
export interface LoweredTextBody {
  /** Imperative C++ statement(s) writing into `buf` (the textFn param). */
  cppBody: string;
}

/** Format specifier for a single numeric interpolation per spec §5.3.
 *  - bare int/uint/bool signal read  → "%d"
 *  - bare float/double signal read   → "%g"
 *  - anything else (arithmetic, non-signal, literal) → "%d" (default; v1) */
function numericFormat(expr: ts.Expression): string {
  if (ts.isCallExpression(expr) && ts.isIdentifier(expr.expression) &&
      expr.arguments.length === 0 && isSignalName(expr.expression.text)) {
    const t = signalCppType(expr.expression.text);
    if (t === "float" || t === "double") return "%g";
  }
  return "%d";
}

/** Lower a single expression as a snprintf argument.
 *  - signal read `name()` → "name"
 *  - numeric literal / other → rendered via the shared expression renderer */
function lowerInterpolationArg(expr: ts.Expression, sourceText: string, diagnostics: Diagnostic[]): string {
  if (ts.isCallExpression(expr) && ts.isIdentifier(expr.expression) &&
      expr.arguments.length === 0 && isSignalName(expr.expression.text)) {
    return expr.expression.text;
  }
  return renderExprAsText(expressionToIR(expr, sourceText, diagnostics));
}

/**
 * Lower a text-binding arrow body to an imperative C++ statement that writes
 * into `buf` (the textFn's first parameter, size `size`). Recognizes three
 * shapes (spec §5.2): String(<numeric>), a bare string literal, and a template
 * literal with numeric interpolations. Anything else produces a safe no-op
 * (`buf[0] = 0;`) plus a `ui-bind-text-unlowered` warning so the author sees it.
 *
 * Pure function of the AST + the recorded signal table; no side effects beyond
 * pushing diagnostics.
 */
export function lowerTextBindingBody(
  body: ts.Expression,
  fileName: string,
  sourceText: string,
  diagnostics: Diagnostic[],
): LoweredTextBody {
  const warn = () => {
    diagnostics.push({
      severity: "warning",
      code: "ui-bind-text-unlowered",
      message: `ui.bind text: this arrow-body shape is not supported in v1. Supported: String(<signal>), a string literal, or a template literal with numeric interpolations. The node will display an empty string.`,
    } as Diagnostic);
    return { cppBody: "buf[0] = 0;" };
  };

  // Shape 1: String(<numeric expr>)
  if (ts.isCallExpression(body) && ts.isIdentifier(body.expression) &&
      body.expression.text === "String" && body.arguments.length === 1) {
    const arg = body.arguments[0];
    const fmt = numericFormat(arg);
    const argText = lowerInterpolationArg(arg, sourceText, diagnostics);
    return { cppBody: `snprintf(buf, size, "${fmt}", ${argText});` };
  }

  // Shape 2: bare string literal
  if (ts.isStringLiteral(body)) {
    const escaped = escapeCppStringLiteral(body.text);
    return { cppBody: `snprintf(buf, size, "%s", "${escaped}");` };
  }

  // Shape 3: template literal with numeric interpolations.
  // Build the format string by alternating literal fragments and %specifiers,
  // and collect the matching argument expressions in order.
  if (ts.isTemplateExpression(body)) {
    const fmtBuf: string[] = [escapeCppStringLiteral(body.head.text)];
    const args: string[] = [];
    for (const span of body.templateSpans) {
      fmtBuf.push(numericFormat(span.expression));
      args.push(lowerInterpolationArg(span.expression, sourceText, diagnostics));
      fmtBuf.push(escapeCppStringLiteral(span.literal.text));
    }
    const fmt = fmtBuf.join("");
    const argList = args.length ? ", " + args.join(", ") : "";
    return { cppBody: `snprintf(buf, size, "${fmt}"${argList});` };
  }

  return warn();
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm vitest run tests/packages/cuttlefish/text-binding-lowering.test.ts --reporter=verbose`
Expected: all 5 PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/cuttlefish/src/ir/transformers/ui-call-resolver.ts tests/packages/cuttlefish/text-binding-lowering.test.ts
git commit -m "feat(ui): lowerTextBindingBody — String(numeric), literal, template + fallback"
```

---

## Task 9: Wire text bindings in `resolveBindCall` to the new lowerer

Plumbs `lowerTextBindingBody` into the call resolver so `ui.bind(node, 'text', fn)` records a `cppBody` instead of falling through to the broken generic renderer.

**Files:**
- Modify: `packages/cuttlefish/src/ir/transformers/ui-call-resolver.ts` (`resolveBindCall`, lines 311–365)
- Test: covered by Task 10's e2e test (no new unit test here — the helper itself was tested in Task 8; this task only wires it in)

- [ ] **Step 1: Read the current `resolveBindCall` to confirm line numbers**

Run: read `packages/cuttlefish/src/ir/transformers/ui-call-resolver.ts` lines 311–365. Confirm the `let cppExpr = ""` block (around lines 341–357) matches what's quoted below.

- [ ] **Step 2: Implement — branch text bindings to `lowerTextBindingBody`**

In `packages/cuttlefish/src/ir/transformers/ui-call-resolver.ts`, find the body of `resolveBindCall`. It currently has (lines ~333–358):

```typescript
  let property = "text";
  if (ts.isStringLiteral(propArg)) property = propArg.text;

  const fnName = `__ui_bind_${property}_${bindings.length}`;

  // Try to extract the C++ expression from the arrow body for the binding fn.
  // For v1 this handles the common pattern: () => (signal() > N ? '#hex' : '#hex')
  // by lowering it to the equivalent C++ ternary with pre-resolved colors.
  let cppExpr = "";
  if (fnArg && (ts.isArrowFunction(fnArg) || ts.isFunctionExpression(fnArg))) {
    // For arrow functions with expression bodies (not block bodies), lower the
    // expression to C++. Block bodies would need statement lowering (future).
    const body = fnArg.body;
    if (ts.isExpression(body)) {
      let raw = renderExprAsText(expressionToIR(body, sourceText, diagnostics));
      // Resolve color string literals to RGB565 hex values. Handles hex,
      // named colors, and rgb()/rgba().
      raw = raw.replace(/"(#[0-9a-fA-F]{6}|#[0-9a-fA-F]{3}|[a-z]+|rgba?\([^)]*\))"/g, (match: string, color: string) => {
        try {
          return `0x${resolveColor(color, "rgb565").toString(16)}`;
        } catch { return match; }
      });
      cppExpr = raw;
    }
  }
  recordBinding({ nodeIndex, property, fnName, cppExpr });
```

Replace it with:

```typescript
  let property = "text";
  if (ts.isStringLiteral(propArg)) property = propArg.text;

  const fnName = `__ui_bind_${property}_${bindings.length}`;

  // Text bindings lower through a dedicated path (spec §5) that emits an
  // imperative snprintf statement into the node's buffer. Color/numeric
  // bindings keep the generic expression path with color-literal resolution.
  let cppExpr = "";
  let cppBody: string | undefined;
  if (fnArg && (ts.isArrowFunction(fnArg) || ts.isFunctionExpression(fnArg))) {
    const body = fnArg.body;
    if (ts.isExpression(body)) {
      if (property === "text") {
        cppBody = lowerTextBindingBody(body, fileName, sourceText, diagnostics).cppBody;
      } else {
        let raw = renderExprAsText(expressionToIR(body, sourceText, diagnostics));
        // Resolve color string literals to RGB565 hex values. Handles hex,
        // named colors, and rgb()/rgba().
        raw = raw.replace(/"(#[0-9a-fA-F]{6}|#[0-9a-fA-F]{3}|[a-z]+|rgba?\([^)]*\))"/g, (match: string, color: string) => {
          try {
            return `0x${resolveColor(color, "rgb565").toString(16)}`;
          } catch { return match; }
        });
        cppExpr = raw;
      }
    }
  }
  recordBinding({ nodeIndex, property, fnName, cppExpr, cppBody });
```

- [ ] **Step 3: Run the full cuttlefish test suite to check for regressions**

Run: `npm vitest run tests/packages/cuttlefish/`
Expected: all PASS. If `ui-call-lowering.test.ts` has any test that asserted on the old text-binding behavior, update it (none expected — that file tests pure helpers per Task 7, not full call resolution).

- [ ] **Step 4: Commit**

```bash
git add packages/cuttlefish/src/ir/transformers/ui-call-resolver.ts
git commit -m "feat(ui): resolveBindCall routes text bindings through lowerTextBindingBody"
```

---

## Task 10: Emit `void textFn(char*, uint8_t)` from `cppBody`; push `<stdio.h>`

The emitter currently generates `const char* fn(void) { return cppExpr; }` for text bindings. Switch to the new signature and the imperative body. Also ensure `<stdio.h>` is included so `snprintf` resolves.

**Files:**
- Modify: `packages/cuttlefish/src/emit/emitters/ui-emitter.ts` (lines 66–72 for the text-binding branch; near line 29 for the include push)
- Test: `tests/packages/cuttlefish/ui-e2e.test.ts`

- [ ] **Step 1: Write the failing e2e test**

Open `tests/packages/cuttlefish/ui-e2e.test.ts` and read how it constructs its HTML/CSS and calls `transpileUI`. Then add a new `describe` block at the bottom of the file. The current e2e test uses `transpileUI` (which lowers HTML+CSS to tables but does NOT run the full resolver pipeline that emits binding functions — those come from `ui.bind` calls in `.ts`). So this test needs a different fixture approach: assert on the emitter's output via the same path `ui-emitter.ts` uses.

Add this to the bottom of `tests/packages/cuttlefish/ui-e2e.test.ts`:

```typescript
import { emitBindingTable } from "../../../packages/cuttlefish/src/ir/transformers/ui-reactive";
import type { BindingSpec } from "../../../packages/cuttlefish/src/ir/transformers/ui-reactive";

describe("text-binding emission (ui.bind → void textFn)", () => {
  it("emits a void fill-style textFn from cppBody", () => {
    // We assert on the exact function shape the emitter must produce.
    // Mirrors the body of ui-emitter.ts's text-binding branch.
    const spec: BindingSpec = {
      nodeIndex: 2,
      property: "text",
      fnName: "__ui_bind_text_0",
      cppBody: `snprintf(buf, size, "%d", count);`,
    };
    // The emitter builds: void <fn>(char* buf, uint8_t size) { <cppBody> }
    const expected = `void __ui_bind_text_0(char* buf, uint8_t size) { snprintf(buf, size, "%d", count); }`;
    // Reconstruct what the emitter does (this assertion guards the shape; the
    // full integration is exercised via the demo build in Task 12).
    const emitted = `void ${spec.fnName}(char* buf, uint8_t size) { ${spec.cppBody} }`;
    expect(emitted).toBe(expected);
  });
});
```

This is a shape-guard test (it reconstructs the emitter's contract from the spec). The real end-to-end check is the demo build in Task 12.

- [ ] **Step 2: Run the test — it passes trivially (it tests the contract, not the emitter)**

Run: `npm vitest run tests/packages/cuttlefish/ui-e2e.test.ts --reporter=verbose`
Expected: PASS (this is a contract test that documents the expected shape before we change the emitter). If it fails, the contract in Step 1 was written wrong — fix the test, not the code.

- [ ] **Step 3: Implement — change the emitter's text-binding branch**

In `packages/cuttlefish/src/emit/emitters/ui-emitter.ts`, find the binding-function emission loop (lines 62–80). The text-binding branch (lines 66–72) currently reads:

```typescript
    const isTextBinding = spec.property === "text";
    if (isTextBinding) {
      // Text bindings return const char* and are wired to textFn.
      const textBody = spec.cppExpr || `"${""}"`;
      ctx.sourceLines.push(
        `const char* ${spec.fnName}(void) { return ${textBody}; }`,
      );
    } else {
```

Replace the text-binding branch with:

```typescript
    const isTextBinding = spec.property === "text";
    if (isTextBinding) {
      // Text bindings are void fill-style: they write into (buf, size).
      // cppBody is the imperative snprintf statement from lowerTextBindingBody.
      const body = spec.cppBody ?? "buf[0] = 0;";
      ctx.sourceLines.push(
        `void ${spec.fnName}(char* buf, uint8_t size) { ${body} }`,
      );
    } else {
```

- [ ] **Step 4: Implement — push `<stdio.h>` include**

In the same file, find the `<SPI.h>` include push near the top of `emitUIRuntime` (lines 28–31):

```typescript
  if (!ctx.includes.includes("<SPI.h>")) {
    ctx.includes.push("<SPI.h>");
  }
```

Add immediately after it:

```typescript
  // snprintf (used by text-binding bodies) needs <stdio.h>.
  if (!ctx.includes.includes("<stdio.h>")) {
    ctx.includes.push("<stdio.h>");
  }
```

- [ ] **Step 5: Run all cuttlefish tests to check for regressions**

Run: `npm vitest run tests/packages/cuttlefish/`
Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/cuttlefish/src/emit/emitters/ui-emitter.ts tests/packages/cuttlefish/ui-e2e.test.ts
git commit -m "feat(ui): emit void fill-style textFn from cppBody; include stdio.h"
```

---

## Task 11: Add the counter text binding to the demo

This both dogfoods the fix and is the clearest correctness signal: the counter now reads "0" → "1" → "2" on each press / every 2s.

**Files:**
- Modify: `demo-ui/src/main.ts`

- [ ] **Step 1: Add the binding**

In `demo-ui/src/main.ts`, find the counter color binding (line 33):

```typescript
// Counter color: limegreen when even, orange when odd
ui.bind(screen.counter, 'color', () => (count() % 2 === 0 ? 'limegreen' : 'orange'));
```

Add a new line immediately after it:

```typescript
// Counter text: reflect the count value as a string
ui.bind(screen.counter, 'text', () => String(count()));
```

- [ ] **Step 2: Commit**

```bash
git add demo-ui/src/main.ts
git commit -m "feat(demo-ui): bind counter text to String(count())"
```

(No automated test for the demo — it's a fixture app, not a test target. Verification is the build in Task 12.)

---

## Task 12: Build packages + transpile the demo; verify emitted C++

The demo transpile is the true end-to-end check that all six source changes compose correctly. There is no automated test for it; this task is the manual verification gate.

**Files:** none (build + inspection only)

- [ ] **Step 1: Rebuild packages in dependency order**

Run from repo root:

```bash
npm run build --workspace @typehal/core
npm run build --workspace @typehal/framework-arduino
npm run build --workspace @typehal/transpiler
```

Expected: all three build successfully (exit 0, no TS errors).

- [ ] **Step 2: Transpile the demo and inspect the emitted C++**

Run the CLI against the demo (use the same command the demo's own build uses — check `demo-ui/package.json` for the exact script; if unclear, run):

```bash
node packages/cuttlefish/dist/cli.js transpile demo-ui/src/main.ts --board esp32-devkit --out demo-ui/build
```

If the CLI binary path or flags differ, consult `demo-ui/package.json`'s `build` script and use that. The goal: produce the emitted `.ino`/`.cpp` for `main.ts`.

- [ ] **Step 3: Inspect the emitted output for the four required markers**

Open the emitted file (likely `demo-ui/build/main.ino` or `main.cpp`). Confirm all four are present:

1. The runtime header now contains `UI_TEXT_BUF`, `textBuffer[UI_TEXT_BUF]`, `hasTextBinding`, and `void (*textFn)(char* buf, uint8_t size)`.
2. The counter's node row contains `.textBuffer={0}, .hasTextBinding=0`.
3. The binding function `void __ui_bind_text_N(char* buf, uint8_t size) { snprintf(buf, size, "%d", count); }` is present.
4. `<stdio.h>` is in the includes.

If any are missing, stop and debug — a previous task did not compose correctly.

- [ ] **Step 4: Run the full repo test suite as a final regression gate**

Run: `npm vitest run`
Expected: all tests pass (the ~768 tests on main plus the new ones added in Tasks 1–10).

- [ ] **Step 5: Commit (only if any fixups were needed during inspection)**

If Steps 1–4 surfaced fixes (e.g. a missed call site), commit them now with a clear message. Otherwise this step is a no-op.

```bash
git status   # confirm clean, or commit fixups
```

---

## Self-Review (run before handing off)

The plan author should re-read the spec (`docs/superpowers/specs/2026-06-21-ui-text-binding-design.md`) and this plan, and confirm:

- **Spec coverage:** Every section of the spec maps to a task. §4.1 (struct) → T1; §4.2 (signature) → T1; §4.3 (seeding) → T2; §4.4 (dispatch) → T3; §4.5 (draw source selection) → T4; §4.6 (SRAM, no code) → noted in spec only; §5.1–5.2 (lowerer location + shapes) → T8; §5.3 (format spec) → T8 (`numericFormat`); §5.4 (emitted fn shape) → T10; §5.5 (fallback) → T8; §5.6 (`cppBody`) → T6; §5.7 (`<stdio.h>`) → T10; §6 file list → T1/T6/T9/T10/T5/T11; §7 testing → T1–T10; §8 out-of-scope → respected (no concat, no PROGMEM, no per-property methods); §9 authoring → T11.
- **Placeholder scan:** No TBD/TODO; every step has the actual code or command.
- **Type consistency:** `lowerTextBindingBody` signature is identical in T8 (definition), T9 (call site), and T8's test. `cppBody` is identical in T6 (interface), T8 (producer), T9 (recording), T10 (consumer). `UI_TEXT_BUF` is `16` everywhere.
