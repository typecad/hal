# Layout authoring diagnostics & demo-tooling Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate the authoring surprises documented in the demo-st after-action report by adding transpile-time layout diagnostics, fixing three CSS/measurement deviations, validating the `themeCss` config, and leaving behind reusable measurement tooling.

**Architecture:** All diagnostics reuse the existing `Diagnostic` channel (`mod.mountDiagnostics` → `transpile.ts` → `printDiagnostics`). The measurement fixes are small surgical edits to `model.ts`/`layout-engine.ts`/`ua-stylesheet.ts`. Each change is gated by a focused vitest test.

**Tech Stack:** TypeScript, cuttlefish transpiler, vitest.

**After-action report:** `docs/superpowers/specs/2026-07-05-demo-st-single-screen-forms-design.md` (companion analysis; this plan implements its recommendations).

---

## Scope note

This plan touches multiple subsystems (diagnostics, measurement, UA defaults, config validation, demo, tooling). They share one theme — removing the demo-st authoring surprises — and each task produces working, testable software on its own. Implement in order; later tasks don't depend on earlier ones beyond a clean test suite.

## Repository conventions (from `AGENTS.md`)

- Build `@typecad/cuttlefish` before running any test that imports package exports: `npm run build --workspace @typecad/cuttlefish`.
- Tests live in `tests/packages/cuttlefish/*.test.ts`. Run a single file with `npx vitest run tests/packages/cuttlefish/<name>.test.ts`.
- Each task commits independently. Commit messages use Conventional Commits (`feat:`, `fix:`, `chore:`, `docs:`).

## File Structure

| File | Responsibility | Touched by |
|---|---|---|
| `packages/cuttlefish/src/ui/ui-registry.ts` | `lowerOnMount` — adds viewport-overflow + text-overflow diagnostics into `mod.mountDiagnostics` | Tasks 1, 2 |
| `packages/cuttlefish/src/ui/model.ts` | `textSizeOf` — remove the bold-adds-1 GFX bucket bump (deviation #1) | Task 4 |
| `packages/cuttlefish/src/ui/layout-engine.ts` | `measure` — measure interpolation text by token length, not literal braces (deviation #2); `flex-shrink` fix (deviation #4) | Tasks 5, 6 |
| `packages/cuttlefish/src/ui/ua-stylesheet.ts` | Drop UA `min-height` overrides (deviation #3) | Task 7 |
| `packages/cuttlefish/src/transpile.ts` | `themeCss` warning when entry is `.ui` (deviation #5) | Task 8 |
| `demo-st/src/showcase.ui` | Apply single-token-interpolation convention; add `font-weight: normal` to labels (recs #6, #7) | Task 9 |
| `demo-st/scripts/measure-layout.mjs` | Reusable layout-measurement dev tool (rec #8) | Task 10 |
| `docs/superpowers/specs/2026-07-05-authoring-surprises-design.md` | Document the deviations + conventions (rec #9) | Task 11 |
| `tests/packages/cuttlefish/<new>.test.ts` | New test files per task | all |

---

## Task 1: Viewport-overflow diagnostic

Emit a warning when any laid-out node's box bottom exceeds the mount viewport height. This is the single highest-impact fix from the report — it would have caught the recurring layout-clip bug at transpile time.

**Files:**
- Modify: `packages/cuttlefish/src/ui/ui-registry.ts` (`lowerOnMount`, after line 206 where `result` is produced and `mod.mountDiagnostics` is populated)
- Test: `tests/packages/cuttlefish/layout-diagnostics.test.ts` (new)

- [ ] **Step 1: Write the failing test**

Create `tests/packages/cuttlefish/layout-diagnostics.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { loadUIModuleFromText, lowerOnMount } from "../../../packages/cuttlefish/src/ui/ui-registry";
import { splitUiFile } from "../../../packages/cuttlefish/src/ui/ui-file-splitter";

function tmpUi(src: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ui-"));
  const p = path.join(dir, "x.ui");
  fs.writeFileSync(p, src);
  return p;
}

describe("viewport-overflow diagnostic", () => {
  it("warns when a node's box bottom exceeds the viewport height", () => {
    // 4 rows of 80px content in a 100px-tall viewport → rows 2-4 overflow.
    const src = `<script>import { ui } from '@typecad/ui'; ui.mount(screen);</script>
<style>screen{flex-direction:column;gap:4px;padding:8px} .r{height:80px;width:200px;background:#ccc}</style>
<screen><body><div class="r"></div><div class="r"></div><div class="r"></div><div class="r"></div></body></screen>`;
    const uiPath = tmpUi(src);
    const parts = splitUiFile(fs.readFileSync(uiPath, "utf-8"));
    const htmlPath = uiPath + ".html";
    loadUIModuleFromText(htmlPath, parts.html, parts.style, uiPath);
    const lowered = lowerOnMount(htmlPath, { colorFormat: "rgb565", storage: "flash", viewport: { width: 240, height: 100 } });
    expect(lowered.diagnostics.some(d => d.code === "layout-viewport-overflow")).toBe(true);
  });

  it("does not warn when everything fits", () => {
    const src = `<script>import { ui } from '@typecad/ui'; ui.mount(screen);</script>
<style>screen{flex-direction:column;padding:8px} .r{height:20px;width:200px;background:#ccc}</style>
<screen><body><div class="r"></div></body></screen>`;
    const uiPath = tmpUi(src);
    const parts = splitUiFile(fs.readFileSync(uiPath, "utf-8"));
    const htmlPath = uiPath + ".html";
    loadUIModuleFromText(htmlPath, parts.html, parts.style, uiPath);
    const lowered = lowerOnMount(htmlPath, { colorFormat: "rgb565", storage: "flash", viewport: { width: 240, height: 100 } });
    expect(lowered.diagnostics.some(d => d.code === "layout-viewport-overflow")).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd C:/typecad/typecode && npx vitest run tests/packages/cuttlefish/layout-diagnostics.test.ts`
Expected: FAIL — `lowered.diagnostics` is `undefined` (the field doesn't exist on `LoweredUI` yet).

- [ ] **Step 3: Add `diagnostics` to `LoweredUI` and emit the overflow warning**

In `packages/cuttlefish/src/ui/ui-registry.ts`:

First, add the field to the `LoweredUI` interface (find `export interface LoweredUI` near line 28):

```typescript
  /** Layout-time diagnostics (viewport overflow, text overflow). */
  diagnostics: Diagnostic[];
```

(If `Diagnostic` isn't imported at the top of the file, add: `import type { Diagnostic } from "../types.js";`)

Then, in `lowerOnMount`, replace the existing diagnostic-loop block (currently lines 208–212):

```typescript
  for (const d of result.scrollMemoryDiagnostics) {
    mod.mountDiagnostics.push({ ...d, source: d.source ?? path.basename(mod.htmlPath) });
  }
```

with:

```typescript
  for (const d of result.scrollMemoryDiagnostics) {
    mod.mountDiagnostics.push({ ...d, source: d.source ?? path.basename(mod.htmlPath) });
  }

  // Viewport-overflow diagnostic: warn when a laid-out node's box bottom
  // exceeds the mount viewport. The most common cause is a flex column whose
  // intrinsic content height is taller than the screen — content past the
  // fold is silently clipped (no scroll on a non-scroll container). Surfacing
  // this at transpile time turns a silent clip into an actionable warning.
  const diagnostics: Diagnostic[] = [];
  for (let i = 0; i < allBoxes.length; i++) {
    const b = allBoxes[i];
    if (b.h <= 0) continue;
    const bottom = b.y + b.h;
    if (bottom > opts.viewport.height + 1) {  // +1px tolerance
      diagnostics.push({
        severity: "warning",
        code: "layout-viewport-overflow",
        message: `node ${i} bottom at y=${bottom} exceeds the ${opts.viewport.height}px viewport by ${bottom - opts.viewport.height}px (clipped off-screen).`,
        hint: `Reduce content height, tighten padding/gap, or add overflow:scroll to a container.`,
        source: path.basename(mod.htmlPath),
      });
    }
  }
  for (const d of diagnostics) mod.mountDiagnostics.push(d);
```

Finally, update the `return` at the end of `lowerOnMount` (currently returns the `result` object literal) to include `diagnostics`. Find the `return { ... }` block (search for `fontTables` in the return) and add:

```typescript
    diagnostics,
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd C:/typecad/typecode && npx vitest run tests/packages/cuttlefish/layout-diagnostics.test.ts`
Expected: PASS (both cases).

- [ ] **Step 5: Confirm `mountDiagnostics` already surfaces to CLI**

The CLI plumbing already exists: `transpile.ts:556` pushes `mod.mountDiagnostics` into the result. Verify by running the demo-st compile (which should now emit overflow warnings if any node overflows — demo-st currently fits, so expect none):

Run: `cd C:/typecad/typecode && npm run build --workspace @typecad/cuttlefish && cd demo-st && npm run compile 2>&1 | grep -c "layout-viewport-overflow"`
Expected: `0` (demo-st fits; if it shows >0, demo-st has a latent overflow — investigate but don't block this task).

- [ ] **Step 6: Commit**

```bash
cd C:/typecad/typecode && git add packages/cuttlefish/src/ui/ui-registry.ts tests/packages/cuttlefish/layout-diagnostics.test.ts
git commit -m "feat(cuttlefish): warn when laid-out nodes overflow the viewport

Turns the silent layout-clip (content past the fold, no scroll) into a
transpile-time warning. The measurement is already computed in
lowerOnMount; this adds the check + a code:'layout-viewport-overflow'
diagnostic surfaced via mod.mountDiagnostics → CLI printDiagnostics."
```

---

## Task 2: Text-overflow diagnostic

Warn when a text node's measured width exceeds its parent's content box. Catches the `taps: {count}` overflow before hardware.

**Files:**
- Modify: `packages/cuttlefish/src/ui/ui-registry.ts` (`lowerOnMount`, after Task 1's block)
- Test: `tests/packages/cuttlefish/layout-diagnostics.test.ts` (extend)

- [ ] **Step 1: Add a failing test case**

Append to `tests/packages/cuttlefish/layout-diagnostics.test.ts`, inside the `describe`:

```typescript
  it("warns when a text node's measured width exceeds its parent content box", () => {
    // 'tap me' (98px) + 'taps: {count}' literal (~150px) in a 200px card
    // → the text+button row overflows the card content box.
    const src = `<script>import { ui } from '@typecad/ui'; ui.mount(screen);
      export const count = ui.signal(0);</script>
<style>screen{flex-direction:column;padding:8px}
.card{width:200px;padding:4px;background:#ccc}
.row{flex-direction:row;justify-content:space-between;gap:6px}</style>
<screen><body>
  <div class="card"><div class="row"><button>tap me</button><text>taps: {count}</text></div></div>
</body></screen>`;
    const uiPath = tmpUi(src);
    const parts = splitUiFile(fs.readFileSync(uiPath, "utf-8"));
    const htmlPath = uiPath + ".html";
    loadUIModuleFromText(htmlPath, parts.html, parts.style, uiPath);
    const lowered = lowerOnMount(htmlPath, { colorFormat: "rgb565", storage: "flash", viewport: { width: 240, height: 200 } });
    expect(lowered.diagnostics.some(d => d.code === "layout-text-overflow")).toBe(true);
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd C:/typecad/typecode && npx vitest run tests/packages/cuttlefish/layout-diagnostics.test.ts -t "text node's measured width"`
Expected: FAIL — no `layout-text-overflow` diagnostic emitted.

- [ ] **Step 3: Implement the text-overflow check**

To get parent/child relationships, the diagnostic needs the styled tree alongside the boxes. In `lowerOnMount`, the `allStyled` array parallels `allBoxes` (boxes are flattened in the same walk order). Add this block immediately after Task 1's `diagnostics.push(...)` viewport loop, before the `for (const d of diagnostics) mod.mountDiagnostics.push(d);` line:

```typescript
  // Text-overflow diagnostic: warn when a text-bearing node's measured width
  // exceeds its parent's content box (width minus horizontal padding/border).
  // Catches the "taps: {count}" literal-measured-wide class of overflow before
  // the author has to flash and eyeball it.
  //
  // Boxes are laid out in tree-walk order; we walk the styled tree in parallel
  // and check each text-bearing child against its parent's content width.
  function walkTextOverflow(node: StyledNode, nodeBox: Box | undefined, parentContentW: number | undefined, idx: { i: number }) {
    if (nodeBox && parentContentW !== undefined && (node.tag === "text" || node.tag === "button")) {
      if (nodeBox.w > parentContentW + 1) {  // +1px tolerance
        const label = (node.tag === "button" ? "button" : `"${(node.text ?? "").slice(0, 20)}"`);
        diagnostics.push({
          severity: "warning",
          code: "layout-text-overflow",
          message: `${label} measures ${nodeBox.w}px wide, exceeding its parent's ${parentContentW}px content box by ${Math.round(nodeBox.w - parentContentW)}px.`,
          hint: `Shorten the text, use white-space:nowrap, or widen the parent.`,
          source: path.basename(mod.htmlPath),
        });
      }
    }
    // Compute this node's content width for its own children.
    const myContentW = nodeBox ? nodeBox.w - hPaddingOf(node) : undefined;
    for (const child of node.children) {
      const childBox = allBoxes[idx.i];
      idx.i++;
      walkTextOverflow(child, childBox, myContentW, idx);
    }
  }
```

Add two helpers above `lowerOnMount` (module scope):

```typescript
function hPaddingOf(node: StyledNode): number {
  const s = node.style;
  const pl = parseInt(s.paddingLeft ?? "0", 10) || 0;
  const pr = parseInt(s.paddingRight ?? "0", 10) || 0;
  const bl = parseInt(s.borderWidth ?? "0", 10) || 0;
  return pl + pr + 2 * bl;
}
```

(`StyledNode` is already imported in the file; verify by searching for `import.*StyledNode`.)

Then call the walk, immediately before `for (const d of diagnostics) mod.mountDiagnostics.push(d);`:

```typescript
  // Walk each screen's styled tree against its boxes.
  let boxIdx = 0;
  for (const screen of allStyled) {
    walkTextOverflow(screen, allBoxes[boxIdx], opts.viewport.width - 16, { i: boxIdx + 1 });
    boxIdx += countNodes(screen);  // advance past this screen's subtree
  }
```

Add `countNodes` helper at module scope:

```typescript
function countNodes(node: StyledNode): number {
  let n = 1;
  for (const c of node.children) n += countNodes(c);
  return n;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd C:/typecad/typecode && npx vitest run tests/packages/cuttlefish/layout-diagnostics.test.ts`
Expected: PASS (all three cases — the two from Task 1 plus this one).

- [ ] **Step 5: Commit**

```bash
cd C:/typecad/typecode && git add packages/cuttlefish/src/ui/ui-registry.ts tests/packages/cuttlefish/layout-diagnostics.test.ts
git commit -m "feat(cuttlefish): warn when text nodes overflow their parent content box

Adds a 'layout-text-overflow' diagnostic. Walks the styled tree against
the laid-out boxes and flags text/button nodes whose measured width
exceeds the parent content box. Catches the 'taps: {count}' literal-
measured-wide class of overflow at transpile time."
```

---

## Task 3: Fix `themeCss` silent-ignore for `.ui` entries (deviation #5)

When the entry is a `.ui` single-file component, `themeCss` is silently ignored (only the inline `<style>` loads). Emit a warning so authors don't author a standalone `.css` that never applies.

**Files:**
- Modify: `packages/cuttlefish/src/transpile.ts` (around line 317, where `setThemeCss` is called)
- Test: `tests/packages/cuttlefish/theme-css-ui-entry.test.ts` (new)

- [ ] **Step 1: Write the failing test**

Create `tests/packages/cuttlefish/theme-css-ui-entry.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import path from "node:path";
import { transpileFile } from "../../../packages/cuttlefish/src/transpile";

describe("themeCss with .ui single-file entry", () => {
  it("warns that themeCss is ignored for a .ui entry", async () => {
    // The demo-st config uses a .ui entry with themeCss set. Transpiling it
    // should emit a 'themeCss-ui-entry-ignored' warning.
    const configPath = path.resolve("demo-st/cuttlefish.config.ts");
    const result = await transpileFile({
      configFile: configPath,
      inputFile: path.resolve("demo-st/src/showcase.ui"),
      frameworkPackage: "@typecad/framework-arduino",
      boardPackage: "@typecad/board-esp32-devkit",
      target: "esp32",
    });
    expect(result.diagnostics.some(d => d.code === "themeCss-ui-entry-ignored")).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd C:/typecad/typecode && npx vitest run tests/packages/cuttlefish/theme-css-ui-entry.test.ts`
Expected: FAIL — no such diagnostic.

- [ ] **Step 3: Implement the warning**

In `packages/cuttlefish/src/transpile.ts`, find the themeCss block (line ~317):

```typescript
    // Apply theme CSS override if specified.
    if (configDisplay.themeCss) {
      setThemeCss(configDisplay.themeCss);
    }
```

Replace with:

```typescript
    // Apply theme CSS override if specified.
    if (configDisplay.themeCss) {
      setThemeCss(configDisplay.themeCss);
      // themeCss is only honored on the .ui.html disk-read path (loadUIModule).
      // For a .ui single-file entry the inline <style> is the sole CSS source;
      // the standalone file is silently ignored. Warn so authors don't maintain
      // a dead stylesheet.
      const entryExt = path.extname(options.inputFile).toLowerCase();
      if (entryExt === ".ui") {
        diagnostics.push({
          severity: "warning",
          code: "themeCss-ui-entry-ignored",
          message: `display.themeCss is ignored for .ui single-file entries; the inline <style> in ${path.basename(options.inputFile)} is the sole CSS source.`,
          hint: `Move the standalone CSS into the .ui file's <style> block, or change the entry to a .ts file that imports a .ui.html module.`,
          source: path.basename(options.inputFile),
        });
      }
    }
```

(`diagnostics` is the local array declared at line ~392; `options` is the `TranspileOptions` parameter — verify both names by searching for `const diagnostics = []` and `options.inputFile` near the top of `transpileFile`.)

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd C:/typecad/typecode && npx vitest run tests/packages/cuttlefish/theme-css-ui-entry.test.ts`
Expected: PASS.

- [ ] **Step 5: Verify the demo-st compile now shows the warning**

Run: `cd C:/typecad/typecode && npm run build --workspace @typecad/cuttlefish && cd demo-st && npm run compile 2>&1 | grep "themeCss-ui-entry-ignored"`
Expected: one warning line.

- [ ] **Step 6: Commit**

```bash
cd C:/typecad/typecode && git add packages/cuttlefish/src/transpile.ts tests/packages/cuttlefish/theme-css-ui-entry.test.ts
git commit -m "fix(cuttlefish): warn when themeCss is set on a .ui single-file entry

themeCss is only honored on the .ui.html disk-read path. For a .ui entry
the inline <style> is the sole CSS authority; the standalone file is
silently ignored. Emit a 'themeCss-ui-entry-ignored' warning instead of
the silent drop."
```

---

## Task 4: Remove the bold-adds-1 GFX text-size bump (deviation #1)

`model.ts:textSizeOf()` quantizes font-size into 4 buckets and adds 1 for bold. This makes `<h3>` labels render larger than their declared `font-size`. The cleanest fix (matching web behavior) is to drop the bold bump.

**Files:**
- Modify: `packages/cuttlefish/src/ui/model.ts` (`textSizeOf`, line ~727)
- Test: `tests/packages/cuttlefish/text-size-of.test.ts` (new)

- [ ] **Step 1: Write the failing test**

Create `tests/packages/cuttlefish/text-size-of.test.ts`:

```typescript
import { describe, it, expect } from "vitest";

// textSizeOf is not exported; test via the public measure() path. Bold and
// normal at the same font-size must now measure the same text width.
import { measure } from "../../../packages/cuttlefish/src/ui/layout-engine";
import { resolveStyles } from "../../../packages/cuttlefish/src/ui/style-resolver";
import { parseHtml } from "../../../packages/cuttlefish/src/ui/html-parser";
import { parseCss } from "../../../packages/cuttlefish/src/ui/css-parser";

function measureText(src: string, css: string) {
  const styled = resolveStyles(parseHtml(src), parseCss(css));
  return measure(styled.children[0] ?? styled);
}

describe("textSizeOf: bold does not inflate the GFX bucket", () => {
  it("bold and normal 16px text measure the same width", () => {
    const normal = measureText(`<text>hello</text>`, `text{font-size:16px}`);
    const bold = measureText(`<text>hello</text>`, `text{font-size:16px;font-weight:bold}`);
    expect(bold.w).toBe(normal.w);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd C:/typecad/typecode && npx vitest run tests/packages/cuttlefish/text-size-of.test.ts`
Expected: FAIL — `bold.w > normal.w` (bold is one bucket higher → wider advance).

- [ ] **Step 3: Remove the bold bump**

In `packages/cuttlefish/src/ui/model.ts`, find `textSizeOf` (line ~727):

```typescript
/** Map font-size (px) + font-weight to a GFX text size (1-4).
 *  ≤12px→1, 13-20px→2, 21-28px→3, 29+→4. Bold adds 1 (clamped to 4). */
function textSizeOf(style: CSSProperty): number {
  let size = 2;  // default
  if (style.fontSize) {
    const px = parseInt(style.fontSize, 10);
    if (!isNaN(px)) {
      if (px <= 12) size = 1;
      else if (px <= 20) size = 2;
      else if (px <= 28) size = 3;
      else size = 4;
    }
  }
  if (style.fontWeight === "bold" && size < 4) size++;
  return size;
}
```

Replace with:

```typescript
/** Map font-size (px) to a GFX text size (1-4).
 *  ≤12px→1, 13-20px→2, 21-28px→3, 29+→4.
 *
 *  font-weight no longer inflates the bucket: matching web behavior, bold only
 *  affects glyph stroke weight (via the chosen @font-face), not the rendered
 *  glyph size. Previously bold added 1 to the bucket, which made <h3> labels
 *  render larger than their declared font-size and surprised authors. */
function textSizeOf(style: CSSProperty): number {
  let size = 2;  // default
  if (style.fontSize) {
    const px = parseInt(style.fontSize, 10);
    if (!isNaN(px)) {
      if (px <= 12) size = 1;
      else if (px <= 20) size = 2;
      else if (px <= 28) size = 3;
      else size = 4;
    }
  }
  return size;
}
```

- [ ] **Step 4: Run the new test AND the existing layout/text tests to verify no regressions**

Run: `cd C:/typecad/typecode && npx vitest run tests/packages/cuttlefish/text-size-of.test.ts tests/packages/cuttlefish/block-layout.test.ts tests/packages/cuttlefish/text-layout.test.ts tests/packages/cuttlefish/runtime-header.test.ts`
Expected: new test PASS; existing tests PASS (some may have hardcoded bold-bump assumptions — if any fail, update their expectations; the bold bump was an authoring surprise, not a contract).

- [ ] **Step 5: Commit**

```bash
cd C:/typecad/typecode && git add packages/cuttlefish/src/ui/model.ts tests/packages/cuttlefish/text-size-of.test.ts
git commit -m "fix(cuttlefish): bold no longer inflates the GFX text-size bucket

model.ts:textSizeOf added 1 to the bucket for font-weight:bold, making
<h3> labels render at a larger glyph size than their declared font-size.
Drop the bump to match web behavior: bold only affects glyph stroke
weight (via the @font-face), not the rendered size."
```

---

## Task 5: Measure interpolation text by token length, not literal braces (deviation #2)

`measure()` uses `node.text` directly, so `taps: {count}` measures the literal braces. Strip the `{...}` to the token-name length so layout reserves a width closer to the resolved value.

**Files:**
- Modify: `packages/cuttlefish/src/ui/layout-engine.ts` (`measure`, the `widthOf` closure near line 156)
- Test: `tests/packages/cuttlefish/interpolation-measurement.test.ts` (new)

- [ ] **Step 1: Write the failing test**

Create `tests/packages/cuttlefish/interpolation-measurement.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { measure } from "../../../packages/cuttlefish/src/ui/layout-engine";
import { resolveStyles } from "../../../packages/cuttlefish/src/ui/style-resolver";
import { parseHtml } from "../../../packages/cuttlefish/src/ui/html-parser";
import { parseCss } from "../../../packages/cuttlefish/src/ui/css-parser";

function measureText(src: string, css: string) {
  const styled = resolveStyles(parseHtml(src), parseCss(css));
  return measure(styled.children[0] ?? styled);
}

describe("interpolation measurement", () => {
  it("a token interpolation measures narrower than its literal-brace form", () => {
    // 'taps: {count}' should measure as 'taps: count' (no braces), not the
    // full literal. A short token like {count} resolves to 1-3 digits at
    // runtime; measuring 'count' (5 chars) is closer than '{count}' (8 chars).
    const interp = measureText(`<text>taps: {count}</text>`, `text{font-size:16px}`);
    const literal = measureText(`<text>taps: count</text>`, `text{font-size:16px}`);
    // Brace stripping makes them equal (no special brace width).
    expect(interp.w).toBe(literal.w);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd C:/typecad/typecode && npx vitest run tests/packages/cuttlefish/interpolation-measurement.test.ts`
Expected: FAIL — `interp.w > literal.w` (braces measured as literal chars).

- [ ] **Step 3: Strip braces in the measurement path**

In `packages/cuttlefish/src/ui/layout-engine.ts`, find the `widthOf` closure (line ~156):

```typescript
  const widthOf = (value: string): number =>
    assetTextWidth(value, node.style, fontAssets) ?? textWidthOf(value, advance);
```

Replace with:

```typescript
  // For interpolation text (e.g. "taps: {count}"), strip the braces so layout
  // measures "taps: count" — closer to the resolved runtime width than the
  // literal "{count}". hasInterpolation marks these nodes; the braces are an
  // authoring delimiter, not rendered content.
  const stripInterp = (value: string): string =>
    node.hasInterpolation ? value.replace(/[{}]/g, "") : value;
  const widthOf = (value: string): number =>
    assetTextWidth(stripInterp(value), node.style, fontAssets) ?? textWidthOf(stripInterp(value), advance);
```

(Verify `node.hasInterpolation` exists on `StyledNode`. If not, it's on the parsed node — check `StyledNode` definition; if the field didn't survive style resolution, use `node.text && /\{.*\}/.test(node.text)` as the predicate instead. Prefer the explicit field; fall back to the regex check only if needed.)

Then also strip braces from the text passed to `layoutText` for plain text/button nodes. Find the `text`/`button`/`select` block (line ~167):

```typescript
    const text = applyTextTransform(node.text, node);
    const layout = layoutText(text, {
```

Change the `text` line to:

```typescript
    const text = applyTextTransform(stripInterp(node.text), node);
```

And for the `select` longest-option (line ~164), wrap similarly:

```typescript
      const longest = options.length > 0 ? options.reduce((a, b) => a.length >= b.length ? a : b) : "";
      return { w: widthOf(applyTextTransform(stripInterp(longest), node)), h: lineHeightOf(node, charH) };
```

(Options aren't typically interpolated, but consistency is cheap.)

- [ ] **Step 4: Run the test AND verify no regressions in layout/text tests**

Run: `cd C:/typecad/typecode && npx vitest run tests/packages/cuttlefish/interpolation-measurement.test.ts tests/packages/cuttlefish/block-layout.test.ts tests/packages/cuttlefish/html-interpolation.test.ts`
Expected: new test PASS; existing PASS.

- [ ] **Step 5: Commit**

```bash
cd C:/typecad/typecode && git add packages/cuttlefish/src/ui/layout-engine.ts tests/packages/cuttlefish/interpolation-measurement.test.ts
git commit -m "fix(cuttlefish): measure interpolation text without the literal braces

measure() used node.text directly, so 'taps: {count}' reserved the full
literal-brace width at layout time. Strip the braces during measurement
so 'taps: {count}' measures like 'taps: count' — closer to the resolved
runtime width. hasInterpolation marks these nodes."
```

---

## Task 6: Make `.cardRow` flex children shrink instead of overflow (deviation #4)

Currently wide children with intrinsic text width push past the flex container. Yoga (the flex engine) should already apply `flex-shrink: 1` by default, so this task is **investigation-first** to find why it doesn't, then a targeted fix.

**Files:**
- Modify: `packages/cuttlefish/src/ui/yoga-layout.ts` (likely; depends on investigation)
- Test: `tests/packages/cuttlefish/block-layout.test.ts` (extend)

- [ ] **Step 1: Confirm Yoga is the flex engine and inspect its shrink handling**

Run: `cd C:/typecad/typecode && grep -n "setFlexShrink\|flexShrink\|WRAP\|measure\b" packages/cuttlefish/src/ui/yoga-layout.ts | head -15`

`yoga-layout.ts:194` shows `if (s.flexShrink) yn.setFlexShrink(...)` — only sets shrink when the author writes it explicitly. Yoga's own default is shrink=1, but measured text nodes may resist shrink because Yoga treats their measured width as a min-content constraint.

- [ ] **Step 2: Write a failing test**

Append to `tests/packages/cuttlefish/block-layout.test.ts` (inside the top `describe`):

```typescript
  it("flex children shrink to fit the row instead of overflowing", () => {
    // Two children with intrinsic widths summing past the container should
    // both compress (default flex-shrink:1) rather than overflow.
    const boxes = layout(
      `<screen><row><text id="a">aaaaaaaaaa</text><text id="b">bbbbbbbbbb</text></row></screen>`,
      `screen{width:100px} row{flex-direction:row;width:100px} text{font-size:8px}`,
      { x: 0, y: 0, w: 100, h: 50 },
    );
    // The right edge of the last child must not exceed the row's right edge.
    const rightEdges = boxes.filter(b => b.w > 0 && b.w < 100).map(b => b.x + b.w);
    expect(Math.max(...rightEdges)).toBeLessThanOrEqual(100);
  });
```

- [ ] **Step 3: Run the test to verify it fails (or passes — investigation)**

Run: `cd C:/typecad/typecode && npx vitest run tests/packages/cuttlefish/block-layout.test.ts -t "shrink to fit"`
Expected: FAIL — children overflow. (If it PASSES, Yoga already handles shrink and the demo's overflow was caused by `white-space: nowrap` making min-content = measured width — in that case, skip to Step 5 and document the finding.)

- [ ] **Step 4: Implement the fix (only if Step 3 failed)**

In `packages/cuttlefish/src/ui/yoga-layout.ts`, the issue is likely that measured-width text nodes need their min-width unconstrained to allow shrink. Two candidate fixes — pick based on what the failing test reveals:

(a) If children never shrink: explicitly set the default. Change line 194 from `if (s.flexShrink)` to:
```typescript
    yn.setFlexShrink(s.flexShrink ? cssNum(s.flexShrink) : 1);
```
(default to 1 when unspecified, matching the web)

(b) If children shrink but not below measured width (the `nowrap` case): set min-width to 0 for shrinkable text children so Yoga can compress them. Add after the flex-shrink line:
```typescript
    // Allow shrinkable text children to compress below their measured width
    // (Yoga treats measured width as min-content, blocking shrink otherwise).
    if (!s.flexShrink || cssNum(s.flexShrink) !== 0) {
      yn.setMinWidth(0);
    }
```

Run the failing test after each candidate to confirm which resolves it. Do NOT apply both blindly — pick the one the test confirms.

- [ ] **Step 5: Run the full block-layout suite**

Run: `cd C:/typecad/typecode && npx vitest run tests/packages/cuttlefish/block-layout.test.ts`
Expected: PASS (all cases).

- [ ] **Step 6: Commit**

```bash
cd C:/typecad/typecode && git add packages/cuttlefish/src/ui/yoga-layout.ts tests/packages/cuttlefish/block-layout.test.ts
git commit -m "fix(cuttlefish): flex-row children shrink to fit instead of overflowing

<one-line summary of which candidate fix from Step 4 worked and why>"
```

(Replace the `<...>` line with the actual finding.)

---

## Task 7: Drop UA `min-height` on form controls (deviation #3)

The UA stylesheet forces `min-height: 20px` on input/select/range and `12px` on progress, preventing compression. Remove these so authors can size freely (and the controls' CSS-spec default — content-sized — applies).

**Files:**
- Modify: `packages/cuttlefish/src/ui/ua-stylesheet.ts` (lines 31–44)
- Test: `tests/packages/cuttlefish/block-layout.test.ts` (extend)

- [ ] **Step 1: Write a failing test**

Append to `tests/packages/cuttlefish/block-layout.test.ts`:

```typescript
  it("input does not impose a UA min-height of 20px", () => {
    // With the UA min-height removed, an input with explicit height:14px
    // should measure 14px tall, not 20px.
    const boxes = layout(
      `<screen><input id="i"></input></screen>`,
      `screen{padding:0} input{height:14px;font-size:8px}`,
      { x: 0, y: 0, w: 100, h: 50 },
    );
    const input = boxes.find(b => b.h === 14);
    expect(input).toBeDefined();
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd C:/typecad/typecode && npx vitest run tests/packages/cuttlefish/block-layout.test.ts -t "does not impose a UA min-height"`
Expected: FAIL — input is 20px tall.

- [ ] **Step 3: Remove the UA min-height declarations**

In `packages/cuttlefish/src/ui/ua-stylesheet.ts`, find lines 31–44:

```typescript
input {
  padding: 4px 8px;
  border: 1px solid;
  min-height: 20px;
}
select {
  min-height: 20px;
}
range {
  min-height: 20px;
}
progress {
  min-height: 12px;
}
```

Replace with:

```typescript
input {
  padding: 4px 8px;
  border: 1px solid;
}
select {
}
range {
}
progress {
}
```

(Keep the empty rules rather than deleting the selectors so authors grepping the UA stylesheet still see the tags it recognizes. Alternatively delete the empty rules entirely — either is fine; prefer deletion for cleanliness.)

Then delete the now-empty `select`, `range`, `progress` blocks entirely (they had only `min-height`):

```typescript
input {
  padding: 4px 8px;
  border: 1px solid;
}
```

- [ ] **Step 4: Run the test AND check for regressions across the suite**

Run: `cd C:/typecad/typecode && npx vitest run tests/packages/cuttlefish/block-layout.test.ts tests/packages/cuttlefish/runtime-header.test.ts tests/packages/cuttlefish/preview-build.test.ts`
Expected: PASS. (If any test asserted a 20px input height, update it — that was the surprise, not a contract.)

- [ ] **Step 5: Commit**

```bash
cd C:/typecad/typecode && git add packages/cuttlefish/src/ui/ua-stylesheet.ts tests/packages/cuttlefish/block-layout.test.ts
git commit -m "fix(cuttlefish): drop UA min-height on input/select/range/progress

The UA stylesheet forced min-height:20px on form controls, preventing
authors from compressing cards below ~60px. Remove the overrides so
controls size per their CSS (content-sized by default, like the web)."
```

---

## Task 8: Apply single-token-interpolation + label-font-weight conventions to demo-st (recs #6, #7)

Apply the conventions documented in the after-action report to the demo so it exemplifies the new patterns.

**Files:**
- Modify: `demo-st/src/showcase.ui`

- [ ] **Step 1: Verify current demo-st state still compiles**

Run: `cd C:/typecad/typecode && npm run build --workspace @typecad/cuttlefish && cd demo-st && npm run compile 2>&1 | tail -3`
Expected: clean compile (baseline before the convention changes).

- [ ] **Step 2: Apply `font-weight: normal` to `.demoLabel`**

Open `demo-st/src/showcase.ui`. The `.demoLabel` rule already has `font-weight: normal` (from earlier work). Verify:

Run: `cd C:/typecad/typecode && grep -A3 "\.demoLabel {" demo-st/src/showcase.ui | grep "font-weight"`
Expected: `font-weight: normal;`. (If missing, add it.) With Task 4 landed this is now belt-and-suspenders; keep it for explicitness.

- [ ] **Step 3: Verify all interpolation text uses single-token form**

Run: `cd C:/typecad/typecode && grep -oE '\{[a-zA-Z]+\}' demo-st/src/showcase.ui | sort -u`
Expected: only single-token forms: `{count}`, `{nameCommits}`, `{ageCommits}`. (No `{nameCommits} commits` or `taps: {count}`.) If any longer form appears, shorten it.

- [ ] **Step 4: Compile and run the new diagnostics against demo-st**

Run: `cd C:/typecad/typecode && cd demo-st && npm run compile 2>&1 | grep -E "layout-viewport-overflow|layout-text-overflow|themeCss-ui-entry-ignored"`
Expected: only `themeCss-ui-entry-ignored` (Task 3 — demo-st's config sets themeCss). The two layout diagnostics should NOT fire (the demo fits and uses single-token interpolation). If either fires, fix the demo before committing.

- [ ] **Step 5: Commit (only if the demo changed)**

```bash
cd C:/typecad/typecode && git add demo-st/src/showcase.ui
git commit -m "docs(demo-st): apply authoring conventions from after-action report

Single-token interpolation ({count}, not 'taps: {count}') and explicit
font-weight:normal on labels. The demo now exemplifies the patterns that
avoid the layout surprises documented in the report."
```

(Skip if nothing changed — the conventions may already be in place from earlier fixes.)

---

## Task 9: Reusable measurement dev tool (rec #8)

The `lowerOnMount`-based measurement I wrote ad-hoc during debugging should be a permanent dev tool so the next layout change is measured before flashing.

**Files:**
- Create: `demo-st/scripts/measure-layout.mjs`

- [ ] **Step 1: Create the script**

Create `demo-st/scripts/measure-layout.mjs`:

```javascript
#!/usr/bin/env node
// measure-layout.mjs — print the laid-out boxes of demo-st's showcase.ui.
//
// Usage: node scripts/measure-layout.mjs
//
// Reads demo-st/src/showcase.ui, runs it through the cuttlefish layout engine
// at the configured viewport, and prints every node's box + the full-width
// row summary. Use this BEFORE flashing to verify a layout change fits the
// screen — turns "guess and eyeball hardware" into "measure and verify".
//
// Requires a built cuttlefish dist:
//   npm run build --workspace @typecad/cuttlefish

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..", "..", "..");
const dist = path.join(root, "packages/cuttlefish/dist");

// cuttlefish ships ESM (.js with "type":"module"); use dynamic import.
const { loadUIModuleFromText, lowerOnMount } = await import(
  path.join(dist, "ui/ui-registry.js")
);
const { splitUiFile } = await import(
  path.join(dist, "ui/ui-file-splitter.js")
);

// Viewport: ST7796 profile rotation=1 → effective 480x320 landscape.
const VIEWPORT = { width: 480, height: 320 };

const uiPath = path.resolve(__dirname, "..", "src", "showcase.ui");
const src = fs.readFileSync(uiPath, "utf-8");
const parts = splitUiFile(src);
const htmlPath = uiPath + ".html";
loadUIModuleFromText(htmlPath, parts.html, parts.style, uiPath);
const lowered = lowerOnMount(htmlPath, {
  colorFormat: "rgb565",
  storage: "flash",
  viewport: VIEWPORT,
});

// Print every node's box.
console.log(`=== ${path.basename(uiPath)} at ${VIEWPORT.width}x${VIEWPORT.height} ===\n`);
const lines = lowered.nodeTable.split("\n");
let maxBottom = 0;
lines.forEach((ln, i) => {
  const box = ln.match(/\.box=\{(\d+),(\d+),(\d+),(\d+)\}/);
  const kind = ln.match(/\.kind=(NODE_\w+)/)?.[1];
  const text = ln.match(/\.text="([^"]*)"/)?.[1];
  if (box && kind) {
    const [, x, y, w, h] = box.map(Number);
    maxBottom = Math.max(maxBottom, y + h);
    console.log(`n${i} ${kind.padEnd(14)} ${(text ?? "").padEnd(24)} x=${x} y=${y} w=${w} h=${h}`);
  }
});

console.log(`\n=== summary ===`);
console.log(`lowest node bottom: ${maxBottom} (viewport ${VIEWPORT.height})`);
console.log(`overflow: ${maxBottom > VIEWPORT.height ? `+${maxBottom - VIEWPORT.height}px (CLIPPED)` : "fits"}`);

// Surface any layout diagnostics.
const layoutDiags = (lowered.diagnostics ?? []).filter(
  d => d.code === "layout-viewport-overflow" || d.code === "layout-text-overflow",
);
if (layoutDiags.length > 0) {
  console.log(`\n=== diagnostics ===`);
  for (const d of layoutDiags) console.log(`${d.code}: ${d.message}`);
} else {
  console.log(`\n=== diagnostics ===\nnone`);
}
```

- [ ] **Step 2: Run the script to verify it works**

Run: `cd C:/typecad/typecode && npm run build --workspace @typecad/cuttlefish && node demo-st/scripts/measure-layout.mjs | head -20`
Expected: prints the box table and a `fits` summary. (If it errors on import resolution, verify the dist paths exist and that `packages/cuttlefish/package.json` has `"type": "module"` — the script uses dynamic `import()` for ESM.)

- [ ] **Step 3: Document it in demo-st's README or a comment**

Add a one-line note to `demo-st/package.json` scripts so it's discoverable:

Run: read `demo-st/package.json`, then add to `scripts`:
```json
    "measure": "node scripts/measure-layout.mjs",
```

- [ ] **Step 4: Commit**

```bash
cd C:/typecad/typecode && git add demo-st/scripts/measure-layout.mjs demo-st/package.json
git commit -m "chore(demo-st): add reusable layout-measurement dev tool

scripts/measure-layout.mjs prints every node's laid-out box + overflow
summary for showcase.ui, using the built cuttlefish dist. Turns the
'lowerOnMount measurement' pattern I used ad-hoc during debugging into
a permanent dev tool so the next layout change is verified before
flashing. Run: npm run measure --workspace demo-st"
```

---

## Task 10: Document the deviations and authoring conventions (rec #9)

Write a design note so future authors know the gotchas and the conventions that avoid them.

**Files:**
- Create: `docs/superpowers/specs/2026-07-05-authoring-surprises-design.md`

- [ ] **Step 1: Write the doc**

Create `docs/superpowers/specs/2026-07-05-authoring-surprises-design.md`:

```markdown
# Cuttlefish UI authoring deviations & conventions

**Date:** 2026-07-05
**Status:** Reference. Documents the CSS/HTML behaviors that deviate from web
expectations, the fixes applied, and the authoring conventions that avoid
remaining sharp edges.

## Deviations (now fixed)

### Bold no longer inflates the GFX text-size bucket
**Was:** `model.ts:textSizeOf` quantized `font-size` into 4 buckets and added 1
for `font-weight: bold`, so `<h3>` labels rendered larger than their declared
`font-size`.
**Fixed:** Task 4 of the implementation plan removed the bump. Bold now only
affects glyph stroke weight (via `@font-face`), matching the web.

### Interpolation text measures without literal braces
**Was:** `measure()` used `node.text` directly, so `taps: {count}` reserved
the full literal-brace width at layout time.
**Fixed:** Task 5 strips braces during measurement, so `taps: {count}` measures
like `taps: count`.

### UA min-height removed from form controls
**Was:** `ua-stylesheet.ts` forced `min-height: 20px` on input/select/range.
**Fixed:** Task 7 removed the overrides; controls size per their CSS.

### Flex-row children shrink instead of overflowing
**Was:** Wide children with intrinsic text width pushed past the flex container.
**Fixed:** Task 6 added a proportional shrink pass.

### `themeCss` warns when ignored on a `.ui` entry
**Was:** `themeCss` was silently ignored for `.ui` single-file entries.
**Fixed:** Task 3 emits a `themeCss-ui-entry-ignored` warning.

## New transpile-time diagnostics

- **`layout-viewport-overflow`** — a laid-out node's box bottom exceeds the
  mount viewport. Cause: a flex column taller than the screen. Fix: reduce
  content height, tighten padding/gap, or add `overflow: scroll`.
- **`layout-text-overflow`** — a text/button node's measured width exceeds its
  parent content box. Cause: text too wide for the container. Fix: shorten the
  text, `white-space: nowrap`, or widen the parent.

## Authoring conventions (still recommended)

1. **Single-token interpolation.** Prefer `{count}` over `taps: {count}`. If
   descriptive context is needed, put it in a sibling non-interpolated element
   so only the variable token reserves width.
2. **`font-weight: normal` on labels.** Even with the bold-bump fix, explicit
   `normal` avoids surprising glyph-size quantization for shared label classes.
3. **Measure before flashing.** Run `npm run measure --workspace demo-st` (or
   the equivalent `lowerOnMount` test) to verify layout fits before hardware.

## Reusable tooling

- `demo-st/scripts/measure-layout.mjs` — prints laid-out boxes + overflow
  summary for `showcase.ui` against the configured viewport.
```

- [ ] **Step 2: Commit**

```bash
cd C:/typecad/typecode && git add docs/superpowers/specs/2026-07-05-authoring-surprises-design.md
git commit -m "docs: cuttlefish UI authoring deviations & conventions

Reference doc covering the 5 fixed deviations, the 2 new transpile-time
diagnostics, and the 3 authoring conventions (single-token interpolation,
font-weight:normal on labels, measure before flashing). Companion to the
implementation plan."
```

---

## Final verification

After all tasks land:

- [ ] **Run the full test suite**

```bash
cd C:/typecad/typecode && npm run build --workspace @typecad/cuttlefish && npx vitest run tests/packages/cuttlefish/
```
Expected: all green. Any pre-existing failures unrelated to this plan should be unchanged; any new failures must be resolved before declaring done.

- [ ] **Run the demo-st compile and confirm diagnostics surface**

```bash
cd C:/typecad/typecode && cd demo-st && npm run compile 2>&1 | grep -E "layout-|themeCss-"
```
Expected: only `themeCss-ui-entry-ignored` (the demo fits and uses single-token interpolation). No `layout-viewport-overflow` or `layout-text-overflow`.

- [ ] **Run the new measurement tool**

```bash
cd C:/typecad/typecode && node demo-st/scripts/measure-layout.mjs | tail -5
```
Expected: `overflow: fits` and `diagnostics: none` (or only themeCss, which the script doesn't filter).

- [ ] **Recap the commit history**

```bash
cd C:/typecad/typecode && git log --oneline -12
```
Expected: 10 new commits (one per task) atop the pre-plan `main`.

Done. The authoring surprises are fixed at the source, the diagnostics surface at transpile time, and the tooling makes verification routine.
