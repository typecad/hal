# Inline Text Flow / Rich-Text Runs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an inline formatting context so `<p>Hello <b>world</b> <a href="#x">link</a></p>` flows as per-run styled runs on shared wrapped lines, with tappable inline links.

**Architecture:** A text node carries an optional `runs[]`. The parser collects an inline sequence from mixed children; the resolver absorbs it into runs; a new `layoutRuns` greedy breaker produces per-segment geometry; lowering bakes that geometry into the model as struct-of-arrays; both runtimes draw per-segment and sub-test link taps against the baked geometry. Runs are static-only (no bindings); geometry is precomputed at lower time (no runtime re-wrap). Single-string text nodes are 100% unchanged.

**Tech Stack:** TypeScript (cuttlefish transpiler), generated Arduino C++ runtime, Adafruit GFX, vitest.

**Spec:** `docs/superpowers/specs/2026-07-01-inline-text-flow-design.md`

---

## File Structure

**Create:**
- `packages/cuttlefish/src/ui/inline-parser.ts` — `INLINE_TAGS`, `InlineItem` type, `collectInlineSequence()` helper. One responsibility: turn a DOM element's `childNodes` into an ordered inline sequence (or `undefined` if not inline-bearing).
- `packages/cuttlefish/src/ui/run-types.ts` — `TextRun` (resolver-side) and `UITextRunModel`/`RunLines` (model-side) types. Shared run type definitions.
- `packages/cuttlefish/src/ui/rich-layout.ts` — `layoutRuns()` and `RichSegment`/`RichLine`/`RichLayoutResult` types. One responsibility: greedy multi-run wrapping.
- `tests/packages/cuttlefish/inline-runs.test.ts` — parser/resolver run tests.
- `tests/packages/cuttlefish/rich-layout.test.ts` — `layoutRuns` tests.
- `tests/packages/cuttlefish/inline-runs-lowering.test.ts` — lowering + parity tests.

**Modify:**
- `packages/cuttlefish/src/ui/html-parser.ts` — add `b/strong/i/em/u` to `TAG_REMAP`; add `inline?: InlineItem[]` to `UIElementNode`; call `collectInlineSequence()` in `domToUIElementNode`.
- `packages/cuttlefish/src/ui/style-resolver.ts` — add `runs?: TextRun[]` to `StyledNode`; absorb `inline` into runs in `resolveNode`; carry styling-tag defaults.
- `packages/cuttlefish/src/ui/layout-engine.ts` — branch `measure()` for run-bearing nodes to `layoutRuns`.
- `packages/cuttlefish/src/ui/model.ts` — add `runs`/`runLines` to `UINodeModel`; populate in `lowerUIToModel`; enforce static-only.
- `packages/cuttlefish/src/ir/ui-lowering.ts` — emit run arrays to C++ (parallel arrays).
- `packages/cuttlefish/src/ui/runtime-header.ts` — add C++ run fields to `UINode`; add `ui_draw_rich_text()`; branch `NODE_TEXT`; add run hit-test in `ui_touch_up`.
- `packages/cuttlefish/src/ir/ui-element-auto-wire.ts` — register one click handler per run-bearing node with link runs.
- `packages/cuttlefish/src/preview/build-program.ts` — mirror auto-wire for preview run links.
- `packages/cuttlefish/src/preview/host-ui-runtime.ts` — add `drawRichNode()`; branch `drawTextNode`; add run hit-test in click dispatch.

---

## Task 1: Inline sequence parser helper

**Files:**
- Create: `packages/cuttlefish/src/ui/inline-parser.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/packages/cuttlefish/inline-parser.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { collectInlineSequence, InlineItem } from "@typecad/cuttlefish/ui/inline-parser";
import { parseHtml } from "@typecad/cuttlefish/ui/html-parser";

function body(html: string): Element {
  const doc = parseHtml(`<screen>${html}</screen>`);
  // Grab the first child of the first child element of the screen wrapper.
  const screenEl = unwrapScreen(html);
  return screenEl;
}

// Minimal DOM helper for tests: parse a fragment and return its first element child.
function unwrapScreen(inner: string): Element {
  const { JSDOM } = require("jsdom");
  const dom = new JSDOM(`<div>${inner}</div>`);
  const root = dom.window.document.querySelector("div")!;
  return root;
}

describe("collectInlineSequence", () => {
  it("returns undefined for a plain text node (no inline children)", () => {
    const el = unwrapScreen(`<p>Hello world</p>`).firstElementChild!;
    expect(collectInlineSequence(el, [])).toBeUndefined();
  });

  it("collects bare text + a <b> element into an ordered sequence", () => {
    const el = unwrapScreen(`<p>Hello <b>world</b></p>`).firstElementChild!;
    const seq = collectInlineSequence(el, []);
    expect(seq).toBeDefined();
    expect(seq!.map(i => i.kind)).toEqual(["text", "element"]);
    expect((seq![0] as any).text).toBe("Hello ");
    expect((seq![1] as any).origTag).toBe("b");
  });

  it("emits a hard-break item for <br>", () => {
    const el = unwrapScreen(`<p>a<br>b</p>`).firstElementChild!;
    const seq = collectInlineSequence(el, []);
    expect(seq!.map(i => i.kind)).toEqual(["text", "break", "text"]);
  });

  it("recurses into nested inline (b > i)", () => {
    const el = unwrapScreen(`<p>x <b>bold <i>both</i></b> y</p>`).firstElementChild!;
    const seq = collectInlineSequence(el, []);
    // text "x ", element(b)[ text "bold ", element(i)[ text "both" ] ], text " y"
    expect(seq!.length).toBe(3);
    const b = seq![1] as any;
    expect(b.origTag).toBe("b");
    expect(b.inline.length).toBe(2);
    expect((b.inline[1] as any).origTag).toBe("i");
  });

  it("returns undefined when block children are present (view inside p)", () => {
    const el = unwrapScreen(`<p>text <view></view></p>`).firstElementChild!;
    expect(collectInlineSequence(el, [])).toBeUndefined();
  });

  it("captures href on an <a> item", () => {
    const el = unwrapScreen(`<p>see <a href="#home">link</a></p>`).firstElementChild!;
    const seq = collectInlineSequence(el, []);
    const a = seq![1] as any;
    expect(a.origTag).toBe("a");
    expect(a.href).toBe("#home");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/packages/cuttlefish/inline-parser.test.ts`
Expected: FAIL — module `@typecad/cuttlefish/ui/inline-parser` not found.

- [ ] **Step 3: Write minimal implementation**

Create `packages/cuttlefish/src/ui/inline-parser.ts`:

```ts
import { Diagnostic } from "../types.js";

/** Tags whose content participates in inline flow inside a text container. */
export const INLINE_TAGS = new Set(["span", "a", "b", "strong", "i", "em", "u"]);

export type InlineItem =
  | { kind: "text"; text: string }
  | { kind: "element"; tag: string; origTag?: string; classes: string[];
      inlineStyle?: string; href?: string; inline?: InlineItem[] }
  | { kind: "break" };

/** Walk childNodes in document order, building an inline sequence.
 *  Returns undefined when the element is NOT inline-bearing — i.e. when it has
 *  no recognized inline element children AND no bare text mixed with such
 *  children. A plain text-only node returns undefined (it uses the normal
 *  single-string text path). A node with any block child returns undefined
 *  (block children break inline flow). */
export function collectInlineSequence(el: Element, diagnostics: Diagnostic[]): InlineItem[] | undefined {
  const childElements = Array.from(el.children);
  const hasBlockChild = childElements.some(c => !INLINE_TAGS.has(c.tagName.toLowerCase()) && c.tagName.toLowerCase() !== "br");
  if (hasBlockChild) return undefined;

  // Only build a sequence when there's at least one recognized inline element
  // child (otherwise this is plain text, handled by the existing path).
  const hasInlineChild = childElements.some(c => INLINE_TAGS.has(c.tagName.toLowerCase()));
  if (!hasInlineChild) return undefined;

  const seq: InlineItem[] = [];
  for (const child of Array.from(el.childNodes)) {
    const nodeType = (child as any).nodeType;
    if (nodeType === 3) {  // text node
      const text = child.textContent ?? "";
      if (text) seq.push({ kind: "text", text });
      continue;
    }
    const childTag = (child as Element).tagName?.toLowerCase();
    if (childTag === "br") {
      seq.push({ kind: "break" });
      continue;
    }
    if (childTag && INLINE_TAGS.has(childTag)) {
      const cel = child as Element;
      const classes = (cel.getAttribute("class") || "").split(/\s+/).filter(Boolean);
      const subInline = collectInlineSequence(cel, diagnostics);
      seq.push({
        kind: "element",
        tag: "text",
        origTag: childTag,
        classes,
        inlineStyle: cel.getAttribute("style") || undefined,
        href: childTag === "a" ? (cel.getAttribute("href") || undefined) : undefined,
        inline: subInline,
      });
    }
    // Unknown node types are ignored here; the parser's main loop handles warnings.
  }
  return seq;
}
```

- [ ] **Step 4: Add the export to the package**

Verify `inline-parser` is importable via `@typecad/cuttlefish/ui/inline-parser`. The package `exports` map (in `packages/cuttlefish/package.json`) maps `./ui/*` — confirm no change needed, or add the entry if the map is explicit per-file.

Run: `npm run build --workspace @typecad/cuttlefish`

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/packages/cuttlefish/inline-parser.test.ts`
Expected: PASS (all 6 tests).

- [ ] **Step 6: Commit**

```bash
git add packages/cuttlefish/src/ui/inline-parser.ts tests/packages/cuttlefish/inline-parser.test.ts
git commit -m "feat(inline): inline sequence parser helper"
```

---

## Task 2: Wire inline sequence into the HTML parser

**Files:**
- Modify: `packages/cuttlefish/src/ui/html-parser.ts:96-108` (TAG_REMAP), `:18-67` (UIElementNode), `:300-318` (domToUIElementNode)

- [ ] **Step 1: Write the failing test**

Append to `tests/packages/cuttlefish/inline-parser.test.ts` (or a new `inline-parser-integration.test.ts`):

```ts
import { parseHtml } from "@typecad/cuttlefish/ui/html-parser";

describe("html-parser inline integration", () => {
  it("populates node.inline for mixed content and leaves text empty", () => {
    const tree = parseHtml(`<screen><p id="p">Hello <b>world</b></p></screen>`);
    const p = tree.children[0];
    expect(p.inline).toBeDefined();
    expect(p.inline!.length).toBe(2);
    expect(p.text).toBeUndefined();        // inline present → text empty
    expect(p.children).toEqual([]);        // b absorbed, not a child node
  });

  it("does not populate inline for plain text", () => {
    const tree = parseHtml(`<screen><text id="t">hi</text></screen>`);
    expect(tree.children[0].inline).toBeUndefined();
    expect(tree.children[0].text).toBe("hi");
  });

  it("recognizes b/strong/i/em/u (no unknown-tag warning)", () => {
    const diags: any[] = [];
    parseHtml(`<screen><p><b>b</b><strong>s</strong><i>i</i><em>e</em><u>u</u></p></screen>`, diags);
    expect(diags.filter(d => d.code === "unknown-html-tag")).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/packages/cuttlefish/inline-parser-integration.test.ts`
Expected: FAIL — `b/strong/i/em/u` produce unknown-tag warnings; `inline` not populated.

- [ ] **Step 3: Add b/strong/i/em/u to TAG_REMAP and add the inline field**

In `html-parser.ts`, update `TAG_REMAP` (line 101-108) to add styling tags:

```ts
const TAG_REMAP: Record<string, string> = {
  // Block-level containers -> view (flexbox/positioning surface)
  body: "view", div: "view", header: "view", footer: "view", nav: "view",
  main: "view", section: "view", article: "view", aside: "view",
  // Inline/heading text -> text
  span: "text", p: "text",
  h1: "text", h2: "text", h3: "text", h4: "text", h5: "text", h6: "text",
  // Styling tags -> text (inline; resolver applies bold/italic/underline defaults)
  b: "text", strong: "text", i: "text", em: "text", u: "text",
};
```

Add the `inline` field to `UIElementNode` (after `children` at line 64):

```ts
  children: UIElementNode[];
  /** Ordered inline content sequence (text/element/break items). Present only
   *  for text nodes with mixed inline children; absent for plain-text nodes. */
  inline?: InlineItem[];
  options?: Array<{ value: string; text: string }>;
```

Add the import at the top:
```ts
import { collectInlineSequence, InlineItem } from "./inline-parser.js";
```

- [ ] **Step 4: Populate inline in domToUIElementNode**

In `domToUIElementNode` (around line 300), after the existing `childElements.length === 0` text-collection block, add inline collection for text-effective tags. Replace the text-collection block (lines 300-312) with:

```ts
  // Inline-bearing text nodes collect an ordered inline sequence instead of
  // a single text string. Only effective-tag "text" can be inline-bearing.
  let inline: InlineItem[] | undefined;
  if (effectiveTag === "text") {
    inline = collectInlineSequence(el, diagnostics ?? []);
  }

  // Text content: only direct text, and only when there's no inline sequence.
  let text: string | undefined;
  const childElements = Array.from(el.children).filter((c) => {  // ... existing filter unchanged ...
    // ... existing body ...
  });

  if (!inline && childElements.length === 0) {
    const parts: string[] = [];
    for (const child of Array.from(el.childNodes)) {
      if ((child as any).nodeType === 3) {
        parts.push(child.textContent ?? "");
        continue;
      }
      const childTag = (child as Element).tagName?.toLowerCase();
      if (childTag === "br") parts.push("\n");
    }
    const tc = parts.join("").trim();
    if (tc) text = tc;
  }
```

Then in the node object literal (line 315), add `inline`:

```ts
  const node: UIElementNode = { tag: effectiveTag, origTag: remappedFrom, id, classes, text, /* ... existing ... */ inline, children: [] };
```

Note: when `inline` is present, the existing `childElements` filter already excludes inline-only children from becoming separate nodes (they're not in the recursive loop because the loop at line 316 iterates `childElements`, and inline children like `<b>` ARE in childElements — so we must ALSO skip them here). Adjust: change the recursive push to skip inline-absorbed children:

```ts
  for (const child of childElements) {
    // Inline children are absorbed into `inline`; don't also emit them as nodes.
    if (inline && INLINE_TAGS.has(child.tagName.toLowerCase())) continue;
    node.children.push(domToUIElementNode(child, diagnostics));
  }
```

Add `INLINE_TAGS` to the import from inline-parser.

- [ ] **Step 5: Build and run test to verify it passes**

Run: `npm run build --workspace @typecad/cuttlefish && npx vitest run tests/packages/cuttlefish/inline-parser-integration.test.ts`
Expected: PASS.

- [ ] **Step 6: Run the full parser test suite to confirm no regression**

Run: `npx vitest run tests/packages/cuttlefish/css-parser.test.ts tests/packages/cuttlefish/style-resolver.test.ts tests/packages/cuttlefish/ua-stylesheet.test.ts`
Expected: PASS (no new failures).

- [ ] **Step 7: Commit**

```bash
git add packages/cuttlefish/src/ui/html-parser.ts tests/packages/cuttlefish/inline-parser-integration.test.ts
git commit -m "feat(inline): wire inline sequence into html parser"
```

---

## Task 3: Resolver — absorb inline sequence into runs

**Files:**
- Create: `packages/cuttlefish/src/ui/run-types.ts`
- Modify: `packages/cuttlefish/src/ui/style-resolver.ts:29-67` (StyledNode), `:195-257` (resolveNode)

- [ ] **Step 1: Write the failing test**

Create `tests/packages/cuttlefish/inline-runs.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { resolveStyles } from "@typecad/cuttlefish/ui/style-resolver";
import { parseHtml } from "@typecad/cuttlefish/ui/html-parser";
import { parseCss } from "@typecad/cuttlefish/ui/css-parser";

function resolve(src: string, css: string) {
  return resolveStyles(parseHtml(src), parseCss(css));
}

describe("inline run absorption", () => {
  it("absorbs <b> into a bold run on the parent text node", () => {
    const styled = resolve(`<screen><p id="p">Hello <b>world</b></p></screen>`, ``);
    const p = styled.children[0];
    expect(p.runs).toBeDefined();
    expect(p.runs!.length).toBe(2);
    expect(p.runs![0].text).toBe("Hello ");
    expect(p.runs![1].text).toBe("world");
    expect(p.runs![1].style.fontWeight).toBe("bold");  // b default
  });

  it("applies i/em/u defaults", () => {
    const styled = resolve(`<screen><p><i>i</i><em>e</em><u>u</u></p></screen>`, ``);
    const runs = styled.children[0].runs!;
    expect(runs[0].style.fontStyle).toBe("italic");
    expect(runs[1].style.fontStyle).toBe("italic");
    expect(runs[2].style.textDecoration).toBe("underline");
  });

  it("nested inline merges styles (b > i → bold + italic)", () => {
    const styled = resolve(`<screen><p>x <b>bold <i>both</i></b></p></screen>`, ``);
    const runs = styled.children[0].runs!;
    // "x ", "bold " (bold), "both" (bold+italic)
    const both = runs.find(r => r.text === "both")!;
    expect(both.style.fontWeight).toBe("bold");
    expect(both.style.fontStyle).toBe("italic");
  });

  it("a run inherits the parent text node's color and can override", () => {
    const styled = resolve(`<screen><p id="p" style="color:#ff0000">a <b>b</b> <span style="color:#00ff00">c</span></p></screen>`, ``);
    const runs = styled.children[0].runs!;
    expect(runs[0].style.color).toBe("#ff0000");  // inherited
    expect(runs[1].style.color).toBe("#ff0000");  // inherited (b adds bold only)
    expect(runs[2].style.color).toBe("#00ff00");  // overridden
  });

  it("carries href onto <a> runs", () => {
    const styled = resolve(`<screen><p>see <a href="#home">link</a></p></screen>`, ``);
    const runs = styled.children[0].runs!;
    const link = runs.find(r => r.text === "link")!;
    expect(link.href).toBe("#home");
  });

  it("<br> becomes a hard-break run", () => {
    const styled = resolve(`<screen><p>a<br>b</p></screen>`, ``);
    const runs = styled.children[0].runs!;
    expect(runs.find(r => r.hardBreak)).toBeDefined();
  });

  it("plain text node has no runs (regression guard)", () => {
    const styled = resolve(`<screen><text id="t">hi</text></screen>`, ``);
    expect(styled.children[0].runs).toBeUndefined();
    expect(styled.children[0].text).toBe("hi");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/packages/cuttlefish/inline-runs.test.ts`
Expected: FAIL — `runs` undefined on StyledNode.

- [ ] **Step 3: Create the run-types module**

Create `packages/cuttlefish/src/ui/run-types.ts`:

```ts
import { CSSProperty } from "./css-parser.js";

/** A resolver-side rich-text run: one piece of styled inline text. */
export interface TextRun {
  text: string;
  style: Partial<CSSProperty>;  // inherited-or-overridden keys this run sets
  href?: string;                // resolved screen target if from <a href>
  hardBreak?: boolean;          // <br> sentinel
}
```

- [ ] **Step 4: Add runs to StyledNode and absorb inline in resolveNode**

In `style-resolver.ts`, add the import and field:

```ts
import { TextRun } from "./run-types.js";
import { InlineItem } from "./inline-parser.js";
```

Add to `StyledNode` (after `text?: string`):
```ts
  text?: string;
  /** Rich-text runs. Present only for text nodes with mixed inline content;
   *  when present, `text` is empty and the runs are the node's content. */
  runs?: TextRun[];
```

In `resolveNode`, after the inheritance merge (after the `inherited` object is built, ~line 259), add inline absorption. Insert before `const childAncestors`:

```ts
  // Absorb an inline sequence into runs. Each run's style = the parent text
  // node's resolved style + the inline element's matched rules + inheritance,
  // with styling-tag defaults (b/strong→bold, i/em→italic, u→underline) applied
  // as low-priority UA-equivalent rules.
  let runs: TextRun[] | undefined;
  if (sourceInline && sourceInline.length > 0) {
    runs = flattenInline(sourceInline, style, rules, ancestors, node.id, node.classes, diagnostics);
  }
```

This requires threading the source node's `inline` into `resolveNode`. Add `sourceInline?: InlineItem[]` as a param to `resolveNode` and pass `node.inline` from the recursive call. Since `UIElementNode` now has `inline`, pass it directly.

Add the `flattenInline` helper at module scope:

```ts
// Styling-tag default style (applied as low-priority UA-equivalent).
const INLINE_TAG_DEFAULTS: Record<string, Partial<CSSProperty>> = {
  b: { fontWeight: "bold" }, strong: { fontWeight: "bold" },
  i: { fontStyle: "italic" }, em: { fontStyle: "italic" },
  u: { textDecoration: "underline" },
};

function flattenInline(
  items: InlineItem[],
  parentStyle: CSSProperty,
  rules: CSSRule[],
  ancestors: UIElementNode[],
  parentId: string | undefined,
  parentClasses: string[],
  diagnostics: Diagnostic[] | undefined,
): TextRun[] {
  const runs: TextRun[] = [];
  const walk = (items: InlineItem[], inheritedStyle: Partial<CSSProperty>) => {
    for (const item of items) {
      if (item.kind === "break") {
        runs.push({ text: "\n", style: { ...inheritedStyle }, hardBreak: true });
        continue;
      }
      if (item.kind === "text") {
        if (item.text) runs.push({ text: item.text, style: { ...inheritedStyle } });
        continue;
      }
      // element: compute its style.
      const tagDefault = item.origTag ? INLINE_TAG_DEFAULTS[item.origTag] ?? {} : {};
      // Match this inline element's own rules (class/origTag/inlineStyle).
      const matched = matchInlineRules(item, rules, ancestors);
      const runStyle: Partial<CSSProperty> = { ...inheritedStyle, ...tagDefault, ...matched };
      if (item.inline && item.inline.length > 0) {
        walk(item.inline, runStyle);
      } else if (item.text) {
        // text was not modeled on element items in Task 1; inline elements with
        // no sub-sequence carry their textContent via the parser. (The parser
        // recurses via `inline`, so leaf elements have inline=undefined and
        // their text lives in a child text item — handled above.)
      }
    }
  };
  walk(items, parentStyle);
  return runs;
}
```

Add `matchInlineRules` — a helper that resolves an inline element item's style by matching its class/origTag selector against the rule list and parsing its inlineStyle. It reuses `matchesCompound`-style logic; for v1 it matches `.class` and `origTag` element selectors plus the item's `inlineStyle`:

```ts
function matchInlineRules(item: Extract<InlineItem, { kind: "element" }>, rules: CSSRule[], ancestors: UIElementNode[]): Partial<CSSProperty> {
  const out: Partial<CSSProperty> = {};
  for (const rule of rules) {
    // Match if the rule's target compound matches this inline element by class
    // or origTag. (Full combinator matching against ancestors is deferred; v1
    // supports element/class/inlineStyle only for inline runs.)
    const compound = rule.selector.compounds[rule.selector.compounds.length - 1];
    if (compoundMatchesInline(compound, item)) {
      Object.assign(out, rule.properties);
    }
  }
  if (item.inlineStyle) {
    Object.assign(out, parseInlineStyle(item.inlineStyle));
  }
  return out;
}
```

Add `compoundMatchesInline` comparing the compound's tag (against `item.origTag`) and classes (against `item.classes`). Import `SimpleSelector`, `parseInlineStyle` from css-parser (already imported).

- [ ] **Step 5: Build and run test to verify it passes**

Run: `npm run build --workspace @typecad/cuttlefish && npx vitest run tests/packages/cuttlefish/inline-runs.test.ts`
Expected: PASS (all 7 tests).

- [ ] **Step 6: Run full resolver suite for regression**

Run: `npx vitest run tests/packages/cuttlefish/style-resolver.test.ts tests/packages/cuttlefish/ua-stylesheet.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/cuttlefish/src/ui/run-types.ts packages/cuttlefish/src/ui/style-resolver.ts tests/packages/cuttlefish/inline-runs.test.ts
git commit -m "feat(inline): absorb inline sequence into runs in resolver"
```

---

## Task 4: Multi-run layout breaker (`layoutRuns`)

**Files:**
- Create: `packages/cuttlefish/src/ui/rich-layout.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/packages/cuttlefish/rich-layout.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { layoutRuns } from "@typecad/cuttlefish/ui/rich-layout";

// measure helpers
const mono = (s: string) => s.length * 10;       // 10px per char
const wide = (s: string) => s.length * 14;       // bold is wider

describe("layoutRuns", () => {
  it("single-style runs wrap identically to plain word-wrap", () => {
    const runs = [{ text: "aaa bbb ccc", measureText: mono, height: 16, ascent: 14 }];
    const r = layoutRuns(runs, { maxWidth: 30, whiteSpace: "normal" });
    // 30px fits 3 chars: "aaa", "bbb", "ccc" each on their own line
    expect(r.lines.length).toBe(3);
    expect(r.lines[0].segments[0].text).toBe("aaa");
  });

  it("a wider (bold) run breaks earlier than mono would predict", () => {
    const runs = [
      { text: "aaaa", measureText: mono, height: 16, ascent: 14 },     // 40px
      { text: "bb", measureText: wide, height: 16, ascent: 14 },       // 28px
    ];
    const r = layoutRuns(runs, { maxWidth: 60, whiteSpace: "normal" });
    // mono "aaaa" (40) + space + wide "bb" (28) = 70 > 60 → "bb" wraps
    const lastLine = r.lines[r.lines.length - 1];
    expect(lastLine.segments.some(s => s.text.includes("bb"))).toBe(true);
  });

  it("line height is the tallest run on that line", () => {
    const runs = [
      { text: "small ", measureText: mono, height: 16, ascent: 14 },
      { text: "BIG", measureText: (s: string) => s.length * 20, height: 32, ascent: 28 },
    ];
    const r = layoutRuns(runs, { maxWidth: 200, whiteSpace: "normal" });
    expect(r.lines[0].height).toBe(32);  // BIG is taller
  });

  it("hardBreak forces a line break", () => {
    const runs = [
      { text: "a", measureText: mono, height: 16, ascent: 14 },
      { text: "\n", hardBreak: true, measureText: mono, height: 16, ascent: 14 },
      { text: "b", measureText: mono, height: 16, ascent: 14 },
    ];
    const r = layoutRuns(runs, { maxWidth: 200, whiteSpace: "normal" });
    expect(r.lines.length).toBe(2);
  });

  it("nowrap produces a single line", () => {
    const runs = [{ text: "aaa bbb ccc ddd", measureText: mono, height: 16, ascent: 14 }];
    const r = layoutRuns(runs, { maxWidth: 30, whiteSpace: "nowrap" });
    expect(r.lines.length).toBe(1);
  });

  it("records segment x-offsets and runIndex for a split run", () => {
    // One run that must split across two lines.
    const runs = [{ text: "aaa bbb", measureText: mono, height: 16, ascent: 14 }];
    const r = layoutRuns(runs, { maxWidth: 30, whiteSpace: "normal" });
    expect(r.lines.length).toBe(2);
    expect(r.lines[0].segments[0].runIndex).toBe(0);
    expect(r.lines[1].segments[0].runIndex).toBe(0);  // same run, second segment
    expect(r.lines[0].segments[0].x).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/packages/cuttlefish/rich-layout.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

Create `packages/cuttlefish/src/ui/rich-layout.ts`:

```ts
import { whiteSpaceMode, WhiteSpaceMode } from "./text-layout.js";

export interface RichSegment {
  runIndex: number;
  text: string;
  x: number;
  width: number;
}
export interface RichLine {
  segments: RichSegment[];
  width: number;
  height: number;
  ascent: number;
}
export interface RichLayoutResult {
  lines: RichLine[];
  width: number;
  height: number;
}

export interface LayoutRun {
  text: string;
  hardBreak?: boolean;
  measureText: (s: string) => number;
  height: number;
  ascent: number;
}

/** Greedy multi-run wrapper. Generalizes the single-string wrapParagraph to a
 *  sequence of styled runs, measuring each candidate with its own measureText,
 *  breaking at spaces and run boundaries, and emitting per-segment geometry. */
export function layoutRuns(
  runs: LayoutRun[],
  options: { maxWidth?: number; whiteSpace?: string },
): RichLayoutResult {
  const mode = whiteSpaceMode(options.whiteSpace);
  const maxWidth = options.maxWidth && options.maxWidth > 0 ? Math.trunc(options.maxWidth) : undefined;
  const canWrap = mode !== "nowrap" && mode !== "pre" && maxWidth !== undefined;

  // Tokenize: produce a flat list of {runIndex, word, measureText, height, ascent, isBreak}.
  type Token = { runIndex: number; word: string; mt: (s: string) => number; h: number; a: number; isBreak: boolean };
  const tokens: Token[] = [];
  runs.forEach((run, runIndex) => {
    if (run.hardBreak) {
      tokens.push({ runIndex, word: "", mt: run.measureText, h: run.height, a: run.ascent, isBreak: true });
      return;
    }
    // Normalize per white-space mode.
    const text = normalizeRunText(run.text, mode);
    const words = text.split(/ +/).filter(Boolean);
    for (const w of words) tokens.push({ runIndex, word: w, mt: run.measureText, h: run.height, a: run.ascent, isBreak: false });
  });

  const lines: RichLine[] = [];
  let curSegs: RichSegment[] = [];
  let curRunIdx = -1, curText = "", curX = 0, curH = 0, curA = 0;

  const flush = () => {
    if (curSegs.length > 0 || curText) {
      if (curText) curSegs.push({ runIndex: curRunIdx, text: curText, x: curX, width: curRunIdx >= 0 ? tokens.length && 0 : 0 });
    }
    // Recompute segment widths properly (the simple loop above is a sketch;
    // see the real implementation below).
  };

  // Real implementation: walk tokens, build segments per run per line.
  const realLines: RichLine[] = [];
  let segs: RichSegment[] = [];
  let lineW = 0, lineH = 0, lineA = 0;
  // current in-progress segment per run
  let cur: { runIndex: number; text: string; mt: (s: string) => number } | null = null;

  const startLine = () => { segs = []; lineW = 0; lineH = 0; lineA = 0; };
  const commitLine = () => {
    if (cur) { segs.push({ runIndex: cur.runIndex, text: cur.text, x: lineW, width: cur.mt(cur.text) }); lineW += cur.mt(cur.text) + spaceWidth(); }
    realLines.push({ segments: segs, width: lineW, height: lineH, ascent: lineA });
    cur = null;
  };
  const spaceWidth = () => cur ? cur.mt(" ") : 0;

  startLine();
  for (const tok of tokens) {
    if (tok.isBreak) { commitLine(); startLine(); continue; }
    // try add tok.word to current line
    if (!cur || cur.runIndex !== tok.runIndex) {
      if (cur) { segs.push({ runIndex: cur.runIndex, text: cur.text, x: lineW, width: cur.mt(cur.text) }); lineW += cur.mt(cur.text) + (cur.mt(" ") || 0); }
      cur = { runIndex: tok.runIndex, text: tok.word, mt: tok.mt };
    } else {
      const candidate = cur.text + " " + tok.word;
      if (canWrap && lineW - (cur ? 0 : 0) + cur.mt(candidate) > maxWidth! && cur.text) {
        // wrap: commit current segment and line, start new
        segs.push({ runIndex: cur.runIndex, text: cur.text, x: lineW, width: cur.mt(cur.text) });
        commitLine(); startLine();
        cur = { runIndex: tok.runIndex, text: tok.word, mt: tok.mt };
      } else {
        cur.text = candidate;
      }
    }
    lineH = Math.max(lineH, tok.h);
    lineA = Math.max(lineA, tok.a);
  }
  commitLine();

  const width = realLines.reduce((m, l) => Math.max(m, l.width), 0);
  const height = realLines.reduce((s, l) => s + l.height, 0);
  return { lines: realLines, width, height };
}

function normalizeRunText(text: string, mode: WhiteSpaceMode): string {
  if (mode === "pre") return text.replace(/\r\n?/g, "\n");
  if (mode === "pre-line") return text.replace(/\r\n?/g, "\n").replace(/[ \t\f\v]+/g, " ");
  return text.replace(/\s+/g, " ");
}
```

NOTE: the wrap math above is intricate. The implementation should be cleaned up to correctly handle: (a) segment x-accumulation, (b) space width per owning run, (c) the `splitLongWord` fallback for a single token wider than maxWidth (reuse from text-layout.ts by exporting it). If the test in Step 4 fails on geometry details, iterate on the math until all 6 tests pass. The tests are the spec for correctness.

- [ ] **Step 4: Run test and iterate until it passes**

Run: `npm run build --workspace @typecad/cuttlefish && npx vitest run tests/packages/cuttlefish/rich-layout.test.ts`
Expected: PASS (all 6). Iterate on the wrap math as needed; the tests pin the behavior.

- [ ] **Step 5: Run text-layout regression**

Run: `npx vitest run tests/packages/cuttlefish/text-layout.test.ts`
Expected: PASS (no changes to layoutText).

- [ ] **Step 6: Commit**

```bash
git add packages/cuttlefish/src/ui/rich-layout.ts tests/packages/cuttlefish/rich-layout.test.ts
git commit -m "feat(inline): multi-run layout breaker (layoutRuns)"
```

---

## Task 5: Lowering — populate runs and runLines in the model

**Files:**
- Modify: `packages/cuttlefish/src/ui/model.ts:24-118` (UINodeModel), `:806-930` (lowerUIToModel)

- [ ] **Step 1: Write the failing test**

Create `tests/packages/cuttlefish/inline-runs-lowering.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { resolveStyles } from "@typecad/cuttlefish/ui/style-resolver";
import { parseHtml } from "@typecad/cuttlefish/ui/html-parser";
import { parseCss } from "@typecad/cuttlefish/ui/css-parser";
import { lowerUIToModel } from "@typecad/cuttlefish/ui/model";
import { selectEngine } from "@typecad/cuttlefish/ui/select-engine";
import { measure } from "@typecad/cuttlefish/ui/layout-engine";

function lower(html: string, css = "") {
  const styled = resolveStyles(parseHtml(html), parseCss(css));
  const boxes = selectEngine(styled).arrange(styled, { x: 0, y: 0, w: 320, h: 240 }, measure);
  return lowerUIToModel(styled, boxes, { colorFormat: "rgb565" } as any);
}

describe("run lowering", () => {
  it("a run-bearing node lowers to runs[] and runLines", () => {
    const program = lower(`<screen><p id="p">Hello <b>world</b></p></screen>`);
    const p = program.nodes.find(n => n.id === "p")!;
    expect(p.runs).toBeDefined();
    expect(p.runs!.length).toBe(2);
    expect(p.runs![1].text).toBe("world");
    expect(p.runs![1].textSize).toBeGreaterThan(p.runs![0].textSize);  // bold bumps size
    expect(p.runLines).toBeDefined();
    expect(p.runLines!.segRun.length).toBeGreaterThan(0);
  });

  it("a plain text node has no runs/runLines (regression guard)", () => {
    const program = lower(`<screen><text id="t">hi</text></screen>`);
    const t = program.nodes.find(n => n.id === "t")!;
    expect(t.runs).toBeUndefined();
    expect(t.runLines).toBeUndefined();
    expect(t.text).toBe("hi");
  });

  it("link run gets linkTarget = resolved screen index", () => {
    // Two screens: home (0) and other (1). Link targets #other.
    const html = `<screen id="home"><p>go <a href="#other">there</a></p></screen><screen id="other"></screen>`;
    // NOTE: requires multi-screen parse; adjust to use parseAllScreens + per-screen resolve.
    // For this test, mock resolveScreenHref by checking linkTarget !== -1.
    const program = lower(html);
    const linkRun = program.nodes.flatMap(n => n.runs ?? []).find(r => r.text === "there")!;
    expect(linkRun.linkTarget).toBeGreaterThanOrEqual(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/packages/cuttlefish/inline-runs-lowering.test.ts`
Expected: FAIL — `runs`/`runLines` not on UINodeModel.

- [ ] **Step 3: Add model types and fields**

In `model.ts`, add the run model types (near the top after imports):

```ts
export interface UITextRunModel {
  text: string;
  fg: number;
  textSize: number;
  fontFace: number;
  underline: number;
  letterSpacing: number;
  linkTarget: number;  // resolved screen index, -1 = not a link
}
export interface RunLines {
  segRun: number[]; segText: string[]; segX: number[]; segW: number[];
  segLine: number[]; lineY: number[]; lineH: number[];
  lineBaseline: number[]; lineW: number[];
}
```

Add to `UINodeModel` (after `whiteSpaceMode`):
```ts
  runs?: UITextRunModel[];
  runLines?: RunLines;
```

- [ ] **Step 4: Populate runs and runLines in lowerUIToModel**

In the `lowerUIToModel` node-building closure (around line 829), after computing `textSize` etc., add run lowering. Import `layoutRuns` from `rich-layout.js`, `resolveScreenHref` from `../ir/ui-element-auto-wire.js`, and `LayoutRun`:

```ts
    // Rich-text runs: build the run model + precomputed line geometry.
    let runsModel: UITextRunModel[] | undefined;
    let runLinesModel: RunLines | undefined;
    if (node.runs && node.runs.length > 0) {
      const box = box_;  // the node's laid-out box (already computed above)
      const layoutRunsInput: LayoutRun[] = node.runs.map(r => {
        const rTextSize = textSizeOf({ ...node.style, ...r.style } as CSSProperty);
        const rFontFace = fontFaceOf({ ...node.style, ...r.style } as CSSProperty, fontAssets);
        const rFg = r.style.color ? resolveColor(r.style.color, colorFormat) : fg;
        const rUnderline = textDecorationOf(r.style.textDecoration ?? node.style.textDecoration);
        const rLetterSpacing = letterSpacingOf({ ...node.style, ...r.style } as CSSProperty);
        return {
          text: applyTextTransform(r.text, { ...node.style, ...r.style } as CSSProperty),
          hardBreak: r.hardBreak,
          measureText: (s: string) => assetTextWidth(s, { ...node.style, ...r.style } as CSSProperty, fontAssets) ?? textWidthOf(s, 6 * rTextSize + rLetterSpacing),
          height: 8 * rTextSize,
          ascent: 7 * rTextSize,
        };
      });
      const layout = layoutRuns(layoutRunsInput, { maxWidth: box.w, whiteSpace: node.style.whiteSpace });
      // Build runs model (text/fg/textSize/fontFace/underline/letterSpacing/linkTarget per run).
      runsModel = node.runs.map(r => {
        const rStyle = { ...node.style, ...r.style } as CSSProperty;
        const target = r.href ? (resolveScreenHref(r.href) ?? -1) : -1;
        if (r.href && target < 0 && diagnostics) diagnostics.push({ severity: "warning", message: `<a href="${r.href}"> target screen not found`, code: "inline-link-target-unresolved", source: r.href });
        return {
          text: applyTextTransform(r.text, rStyle),
          fg: r.style.color ? resolveColor(r.style.color, colorFormat) : fg,
          textSize: textSizeOf(rStyle),
          fontFace: fontFaceOf(rStyle, fontAssets),
          underline: textDecorationOf(rStyle.textDecoration),
          letterSpacing: letterSpacingOf(rStyle),
          linkTarget: target,
        };
      });
      // Build runLines struct-of-arrays from layout.lines.
      const rl: RunLines = { segRun: [], segText: [], segX: [], segW: [], segLine: [], lineY: [], lineH: [], lineBaseline: [], lineW: [] };
      let y = 0;
      layout.lines.forEach((line, li) => {
        rl.lineY.push(y);
        rl.lineH.push(line.height);
        rl.lineBaseline.push(y + line.ascent);
        rl.lineW.push(line.width);
        y += node.style.lineHeight ? lineHeightOf(node.style, textSize) : line.height;
        for (const seg of line.segments) {
          rl.segRun.push(seg.runIndex);
          rl.segText.push(seg.text);
          rl.segX.push(seg.x);
          rl.segW.push(seg.width);
          rl.segLine.push(li);
        }
      });
      runLinesModel = rl;
    }
```

Then in the returned object literal, add `runs: runsModel, runLines: runLinesModel,`. Also: when `runs` is present, set `text: ""` (override the earlier `text: applyTextTransform(node.text, ...)` which would be empty anyway) and ensure `hasTextBinding: false`.

Note: `box_` must be the variable name holding this node's laid-out box in the closure — verify the actual name (it's `box` passed into the `.map` callback at line 806). Adjust the snippet to use the real variable.

- [ ] **Step 5: Build and run test to verify it passes**

Run: `npm run build --workspace @typecad/cuttlefish && npx vitest run tests/packages/cuttlefish/inline-runs-lowering.test.ts`
Expected: PASS. Iterate if the multi-screen link test needs `parseAllScreens`.

- [ ] **Step 6: Run the broader lowering suite for regression**

Run: `npx vitest run tests/packages/cuttlefish/ui-model.test.ts tests/packages/cuttlefish/ui-lowering.test.ts`
Expected: PASS (no new failures).

- [ ] **Step 7: Commit**

```bash
git add packages/cuttlefish/src/ui/model.ts tests/packages/cuttlefish/inline-runs-lowering.test.ts
git commit -m "feat(inline): lower runs and precomputed runLines into model"
```

---

## Task 6: C++ runtime — emit run arrays and draw rich text

**Files:**
- Modify: `packages/cuttlefish/src/ir/ui-lowering.ts` (emit run arrays), `packages/cuttlefish/src/ui/runtime-header.ts` (UINode fields, ui_draw_rich_text, NODE_TEXT branch, run hit-test)

- [ ] **Step 1: Write the failing test**

Append to `tests/packages/cuttlefish/inline-runs-lowering.test.ts`:

```ts
import { emitRuntimeHeader } from "@typecad/cuttlefish/ui/runtime-header";

describe("C++ runtime rich-text support", () => {
  const header = emitRuntimeHeader();
  it("declares ui_draw_rich_text", () => {
    expect(header).toContain("ui_draw_rich_text");
  });
  it("the NODE_TEXT branch dispatches to ui_draw_rich_text when runCount > 0", () => {
    expect(header).toMatch(/if \(__ui_nodes\[i\]\.runCount > 0\)[\s\S]*?ui_draw_rich_text/);
  });
  it("ui_touch_up sub-tests run hit-rects for link runs", () => {
    expect(header).toContain("ui_rich_link_hit");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/packages/cuttlefish/inline-runs-lowering.test.ts`
Expected: FAIL — `ui_draw_rich_text` not in header.

- [ ] **Step 3: Add C++ UINode run fields**

In `runtime-header.ts`, extend the `UINode` struct (around line 107) to add run storage. Because runs vary per node, store them as parallel global arrays indexed by a run-range on the node (keeps UINode fixed-size):

```c
  // Rich-text runs (runCount > 0 for run-bearing text nodes).
  uint8_t runCount;
  uint16_t runStart;       // index into the global run arrays
```

Add global parallel arrays near the other globals:

```c
// Rich-text run storage (parallel arrays; nodes reference a [runStart, runStart+runCount) range).
static UIRichRun __ui_runs[UI_MAX_RUNS];
static uint16_t __ui_run_count = 0;
// Precomputed wrapped-line segment geometry (parallel arrays).
static UIRichSeg __ui_rich_segs[UI_MAX_RICH_SEGS];
static uint16_t __ui_rich_seg_count = 0;
static UIRichLine __ui_rich_lines[UI_MAX_RICH_LINES];
static uint16_t __ui_rich_line_count = 0;
```

with structs:
```c
typedef struct {
  const char* text;
  uint16_t fg;
  uint8_t textSize;
  uint8_t fontFace;
  uint8_t underline;
  int8_t letterSpacing;
  int8_t linkTarget;   // screen index, -1 = not a link
} UIRichRun;

typedef struct {
  uint8_t runIndex;
  const char* text;
  int16_t x;
  uint16_t w;
  uint8_t line;
} UIRichSeg;

typedef struct {
  int16_t y;
  uint16_t h;
  int16_t baseline;
  uint16_t w;
} UIRichLine;
```

Define capacity constants `UI_MAX_RUNS`, `UI_MAX_RICH_SEGS`, `UI_MAX_RICH_LINES` (e.g. 256/512/256).

- [ ] **Step 4: Add ui_draw_rich_text**

In `runtime-header.ts` (near `ui_draw_wrapped_text`, ~line 2751), add:

```c
static inline void ui_draw_rich_text(uint16_t nodeIdx, int16_t x, int16_t y, uint16_t bg, uint8_t antialias) {
  UINode* n = &__ui_nodes[nodeIdx];
  for (uint8_t li = 0; li < /* n->richLineCount */; li++) {
    UIRichLine* line = &__ui_rich_lines[n->richLineStart + li];
    int16_t lineX = x;
    if (n->textAlign == 1) lineX = x + ((int16_t)n->box.w - (int16_t)line->w) / 2;
    else if (n->textAlign == 2) lineX = x + (int16_t)n->box.w - (int16_t)line->w;
    // iterate segments on this line
    for (uint16_t si = n->richSegStart; si < n->richSegStart + n->richSegCount; si++) {
      UIRichSeg* seg = &__ui_rich_segs[si];
      if (seg->line != li) continue;
      UIRichRun* run = &__ui_runs[n->runStart + seg->runIndex];
      int16_t segY = y + line->baseline - (7 * run->textSize);  // baseline alignment
      ui_draw_text(seg->text, lineX + seg->x, segY, run->fg, bg, run->textSize, antialias, run->fontFace, run->letterSpacing);
      if (run->underline & 1) ui_display_draw_fast_hline(lineX + seg->x, segY + 8 * run->textSize - 1, seg->w, run->fg);
      if (run->underline & 2) ui_display_draw_fast_hline(lineX + seg->x, segY + 4 * run->textSize, seg->w, run->fg);
    }
  }
}
```

Add the `richLineStart/richLineCount/richSegStart/richSegCount` fields to UINode as well (or compute line iteration from a stored count). The auto-wire/emit step (Task 8) populates these ranges; for now add the fields.

- [ ] **Step 5: Branch NODE_TEXT to rich draw**

In the `NODE_TEXT` case (line 3541), after the clear block and before the shadow pass, add the branch:

```c
          if (__ui_nodes[i].runCount > 0) {
            // Rich text: draw via precomputed geometry (no re-wrap).
            // (Shadow pass still uses ui_draw_rich_text with shadow color.)
            if (__ui_nodes[i].textShadowCount > 0) {
              uint16_t tsCol = ui_blend565(__ui_nodes[i].textShadowColor, tsClear, __ui_nodes[i].textShadowAlpha);
              ui_draw_rich_text(i, __ui_nodes[i].box.x + __ui_nodes[i].textShadowOffsetX, drawY + __ui_nodes[i].textShadowOffsetY, tsCol, __ui_nodes[i].fontAntialias);
            }
            uint16_t textBg = /* same textBg computation as the non-rich path */;
            ui_draw_rich_text(i, __ui_nodes[i].box.x, drawY, textBg, __ui_nodes[i].fontAntialias);
            break;
          }
```

Hoist the `textBg` computation (lines 3592-3600) so both paths use it, or duplicate it. The cleanest is to compute `textBg` once before the branch.

- [ ] **Step 6: Add run hit-test in ui_touch_up**

In `ui_touch_up` (line 2073), after the click dispatch (`ui_dispatch(__ui_click_handlers, ...)`) and before the list-tap block, add:

```c
    // Rich-text inline link tap: if the tapped node has link runs, find which
    // link run's segment rect the tap falls within and navigate to its target.
    if (__ui_nodes[clickedNode].runCount > 0) {
      int16_t nx = __ui_last_touch_x - ui_draw_x_for_node(clickedNode);
      int16_t ny = __ui_last_touch_y - ui_draw_y_for_node(clickedNode);
      int8_t target = ui_rich_link_hit(clickedNode, nx, ny);
      if (target >= 0) ui_navigate((uint8_t)target);
    }
```

Add the `ui_rich_link_hit` helper near `ui_hit_test`:

```c
static int8_t ui_rich_link_hit(uint16_t nodeIdx, int16_t x, int16_t y) {
  UINode* n = &__ui_nodes[nodeIdx];
  for (uint16_t si = n->richSegStart; si < n->richSegStart + n->richSegCount; si++) {
    UIRichSeg* seg = &__ui_rich_segs[si];
    UIRichRun* run = &__ui_runs[n->runStart + seg->runIndex];
    if (run->linkTarget < 0) continue;
    UIRichLine* line = &__ui_rich_lines[n->richLineStart + seg->line];
    int16_t sx = seg->x, sy = line->y, sw = seg->w, sh = line->h;
    if (x >= sx && x < sx + sw && y >= sy && y < sy + sh) return run->linkTarget;
  }
  return -1;
}
```

Note: segment x-offsets are relative to the line's left edge (pre-alignment); for the hit-test to be correct, either store absolute x or account for `textAlign`. Simplest: store segment x as absolute within the node box (line origin + seg.x) at lower time. Adjust the model-lowering (Task 5) to bake absolute x, OR apply the alignment offset here. Pick one and document; the test asserts the function exists and is reachable.

- [ ] **Step 7: Emit run arrays from ui-lowering.ts**

In `ui-lowering.ts`, when emitting the node table, emit the run/seg/line arrays and the per-node range fields. Find where node fields are emitted (the `__ui_nodes[i] = { ... }` initializers) and add `runCount`, `runStart`, `richSegStart/Count`, `richLineStart/Count` from the model's `runs`/`runLines`. Also emit the global `__ui_runs[]`, `__ui_rich_segs[]`, `__ui_rich_lines[]` initializer arrays.

Also emit the `linkTarget` per run (the model already has it resolved).

- [ ] **Step 8: Build and run test to verify it passes**

Run: `npm run build --workspace @typecad/cuttlefish && npx vitest run tests/packages/cuttlefish/inline-runs-lowering.test.ts tests/packages/cuttlefish/runtime-header.test.ts`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add packages/cuttlefish/src/ui/runtime-header.ts packages/cuttlefish/src/ir/ui-lowering.ts tests/packages/cuttlefish/inline-runs-lowering.test.ts
git commit -m "feat(inline): C++ rich-text draw + run hit-test"
```

---

## Task 7: Host runtime — draw rich text + run hit-test (parity)

**Files:**
- Modify: `packages/cuttlefish/src/preview/host-ui-runtime.ts`

- [ ] **Step 1: Write the failing test**

Append to `tests/packages/cuttlefish/inline-runs-lowering.test.ts`:

```ts
describe("host runtime rich-text parity", () => {
  it("drawRichNode exists and is called for run-bearing nodes", () => {
    // Inspect the host-ui-runtime source for the drawRichNode method and the
    // drawTextNode branch. (Source-level assertion; full pixel parity is a
    // visual check done in the showcase.)
    const fs = require("fs");
    const src = fs.readFileSync("packages/cuttlefish/src/preview/host-ui-runtime.ts", "utf8");
    expect(src).toContain("drawRichNode");
    expect(src).toMatch(/if \(node\.runs\)[\s\S]*?drawRichNode/);
  });

  it("run hit-test sub-tests runLines link segments", () => {
    const fs = require("fs");
    const src = fs.readFileSync("packages/cuttlefish/src/preview/host-ui-runtime.ts", "utf8");
    expect(src).toContain("richLinkHit");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/packages/cuttlefish/inline-runs-lowering.test.ts`
Expected: FAIL — `drawRichNode` not present.

- [ ] **Step 3: Add drawRichNode and the drawTextNode branch**

In `host-ui-runtime.ts`, near `drawTextNode` (line 1741), add:

```ts
  private drawRichNode(node: MutableNode, drawY: number, ts: number): void {
    if (!node.runLines || !node.runs) return;
    // Clear (same logic as drawTextNode's clear block — reuse or extract).
    const clearW = Math.max(node.box.w, node.lastTextWidth ?? 0);
    const clearH = Math.max(node.box.h, node.lastTextHeight ?? 0);
    let textClear = node.hasBg ? node.bg : node.clearColor;
    if (node.opacity < 100) {
      const backdrop = this.parentClearColor(node);
      textClear = blendRgb565(node.hasBg ? node.bg : node.clearColor, backdrop, node.opacity);
    }
    this.gfx.fillRect(node.box.x, drawY, clearW, clearH, textClear);
    const lineOrigin = (lineW: number) => this.lineX(node, lineW, node.box.x, node.box.w);
    const drawSegs = (fgOverride?: number) => {
      for (let li = 0; li < node.runLines.lineY.length; li++) {
        const lineY = drawY + node.runLines.lineY[li];
        const baseline = drawY + node.runLines.lineBaseline[li];
        const originX = lineOrigin(node.runLines.lineW[li]);
        for (let si = 0; si < node.runLines.segRun.length; si++) {
          if (node.runLines.segLine[si] !== li) continue;
          const run = node.runs[node.runLines.segRun[si]];
          const segY = baseline - (7 * run.textSize);
          const fg = fgOverride ?? run.fg;
          this.drawText(node.runLines.segText[si], originX + node.runLines.segX[si], segY, fg, textClear, run.textSize, node.fontAntialias, run.fontFace, run.letterSpacing);
          if (run.underline & 1) this.gfx.drawFastHLine(originX + node.runLines.segX[si], segY + 8 * run.textSize - 1, node.runLines.segW[si], fg);
        }
      }
    };
    if (node.textShadowCount > 0) {
      const shadowColor = blendRgb565(node.textShadowColor, textClear, node.textShadowAlpha);
      // Shadow pass draws at the offset; for simplicity reuse drawSegs with a color override
      // (a full offset shadow requires translating; acceptable for v1 parity with C++).
      drawSegs(shadowColor);
    }
    drawSegs();
  }
```

Add the `drawTextNode` branch at the top of `drawTextNode`:

```ts
  private drawTextNode(node: MutableNode, displayText: string | undefined, drawY: number, ts: number): void {
    if (node.runs && node.runLines) {
      this.drawRichNode(node, drawY, ts);
      return;
    }
    // ... existing body unchanged ...
  }
```

- [ ] **Step 4: Add the run hit-test in click dispatch**

Find where click callbacks are dispatched (`dispatch("click", nodeIndex)` ~line 2371, or the `dispatch` method ~line 2654). Add a run-link sub-test before/after the generic dispatch:

```ts
  private richLinkHit(nodeIndex: number, tx: number, ty: number): number {
    const node = this.nodes[nodeIndex];
    if (!node.runs || !node.runLines) return -1;
    const drawX = this.drawXForNode(nodeIndex);
    const drawY = this.drawYForNode(nodeIndex);
    const nx = tx - drawX, ny = ty - drawY;
    for (let si = 0; si < node.runLines.segRun.length; si++) {
      const run = node.runs[node.runLines.segRun[si]];
      if (run.linkTarget < 0) continue;
      const li = node.runLines.segLine[si];
      const sx = node.runLines.segX[si], sy = node.runLines.lineY[li];
      const sw = node.runLines.segW[si], sh = node.runLines.lineH[li];
      if (nx >= sx && nx < sx + sw && ny >= sy && ny < sy + sh) return run.linkTarget;
    }
    return -1;
  }
```

In the tap-up handler (find where `__ui_touch_node` equivalent is processed — the `pointerUp`/click path), after identifying the tapped node, call `richLinkHit` and `ui.navigate(target)` if >= 0. Mirror the C++ placement (after click dispatch).

- [ ] **Step 5: Build and run test to verify it passes**

Run: `npm run build --workspace @typecad/cuttlefish && npx vitest run tests/packages/cuttlefish/inline-runs-lowering.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/cuttlefish/src/preview/host-ui-runtime.ts tests/packages/cuttlefish/inline-runs-lowering.test.ts
git commit -m "feat(inline): host runtime rich-text draw + run hit-test"
```

---

## Task 8: Auto-wire run links (C++ + preview)

**Files:**
- Modify: `packages/cuttlefish/src/ir/ui-element-auto-wire.ts:46-60` (autoWireElements walk), `:124-137` (href branch)
- Modify: `packages/cuttlefish/src/preview/build-program.ts:182-198` (visit)

- [ ] **Step 1: Write the failing test**

Append to `tests/packages/cuttlefish/inline-runs.test.ts`:

```ts
import { autoWireElements } from "@typecad/cuttlefish/ir/ui-element-auto-wire";

describe("run-link auto-wire", () => {
  it("registers one click handler for a run-bearing node with a link run", () => {
    // The auto-wire must register the node as tappable so ui_hit_test returns it.
    // Use the recorded handlers API or a spy.
    // (Exact assertion depends on recordClickHandler's test surface; assert the
    //  node index gets a click handler registered.)
    // ... see existing auto-wire tests for the pattern ...
  });
});
```

(Fill in the assertion using the existing auto-wire test pattern; the key behavior: a node with `runs` containing a link run gets exactly one click handler at its node index.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/packages/cuttlefish/inline-runs.test.ts`
Expected: FAIL (or no handler registered).

- [ ] **Step 3: Update autoWireElements to register run-bearing link nodes**

In `ui-element-auto-wire.ts`, the `walk` function (line 49) currently auto-wires nodes with `id || href`. Extend the condition so a node whose `runs` contain a link run is also wired (with a synthetic id if needed):

```ts
  const hasLinkRun = (node as any).runs?.some((r: any) => r.href) ?? false;
  if (node.id || node.href || hasLinkRun) {
    autoWireNode(treeName, node, currentIndex);
  }
```

In `autoWireNode`, the href branch (line 124-137) keys off `node.href`. For run-bearing nodes there's no single href — the link targets live on the runs and are already resolved into the model's `runs[].linkTarget`. So the href branch should register a click handler whose body is empty (the real dispatch happens via `ui_rich_link_hit` in `ui_touch_up`):

```ts
  if (node.href || hasLinkRun) {
    if (node.href) {
      const targetScreen = resolveScreenHref(node.href);
      // ... existing direct-href wiring ...
    } else if (hasLinkRun) {
      // Run-bearing link node: register a no-op click handler so the node is
      // hit-testable. ui_touch_up sub-tests run segments and calls ui_navigate.
      recordClickHandler({
        nodeIndex,
        kind: "click",
        fnName: `__ui_${node.id ?? "richlink" + nodeIndex}_nav`,
        callbackBody: `/* rich-text link; handled by ui_rich_link_hit */`,
      });
    }
  }
```

Wait — `ui_dispatch` calls the handler body, but the actual navigation happens in `ui_touch_up` via `ui_rich_link_hit` BEFORE/AFTER dispatch. Reconcile: either (a) the navigation is entirely in `ui_rich_link_hit` (called from `ui_touch_up` independently of dispatch), making the click handler unnecessary except for hit-test gating, or (b) the click handler body does the navigate. The C++ code in Task 6 Step 6 calls `ui_rich_link_hit` directly in `ui_touch_up`, so the handler body can be empty — but the node must still be hit-testable, which requires it to have a handler (per `hasAnyHandler` / the C++ `ui_dispatch` table). Keep the empty-body handler registration. Document this clearly.

- [ ] **Step 4: Mirror in build-program.ts (preview)**

In `build-program.ts` `visit` (line 182), extend the condition:

```ts
    const hasLinkRun = (node as any).runs?.some((r: any) => r.href) ?? false;
    if (node.href || hasLinkRun) {
      if (node.href) {
        // ... existing href wiring ...
      } else {
        callbacks.push({
          nodeId: node.id ?? `__ui_richlink${nodeIndex}_nav`,
          nodeIndex,
          kind: "click",
          body: `/* rich-text link; handled by richLinkHit */`,
        });
      }
    }
```

And the preview tap path calls `richLinkHit` (added in Task 7).

- [ ] **Step 5: Build and run tests**

Run: `npm run build --workspace @typecad/cuttlefish && npx vitest run tests/packages/cuttlefish/inline-runs.test.ts tests/packages/cuttlefish/inline-runs-lowering.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/cuttlefish/src/ir/ui-element-auto-wire.ts packages/cuttlefish/src/preview/build-program.ts tests/packages/cuttlefish/inline-runs.test.ts
git commit -m "feat(inline): auto-wire rich-text link nodes"
```

---

## Task 9: Enforce static-only (runs vs bindings) + diagnostics

**Files:**
- Modify: `packages/cuttlefish/src/ui/model.ts` (diagnostic on conflict), `packages/cuttlefish/src/ir/ui-element-auto-wire.ts` (skip text binding on run nodes)

- [ ] **Step 1: Write the failing test**

Append to `tests/packages/cuttlefish/inline-runs-lowering.test.ts`:

```ts
describe("runs vs bindings static-only rule", () => {
  it("a PROP_TEXT binding on a run-bearing node is dropped with a diagnostic", () => {
    // Build a node with runs that also has a text binding targeting it.
    // Assert the diagnostic code 'run-text-binding-conflict' is emitted and
    // the node's hasTextBinding stays false.
    // (Requires constructing a binding spec; mirror ui-call-resolver test patterns.)
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/packages/cuttlefish/inline-runs-lowering.test.ts`
Expected: FAIL.

- [ ] **Step 3: Add the conflict check**

In `ui-element-auto-wire.ts` (or `ui-call-resolver.ts` where bindings are recorded), when recording a `PROP_TEXT` binding, check if the target node has `runs`. If so, push a diagnostic and skip:

```ts
  if (property === "text" && nodeHasRuns(targetNodeIndex)) {
    diagnostics.push({ severity: "warning", message: `text binding on node ${targetNodeIndex} ignored — node has rich-text runs (runs are static-only)`, code: "run-text-binding-conflict" });
    return;
  }
```

Implement `nodeHasRuns` by checking the lowered model or carrying a flag. The simplest: during the auto-wire walk, track which node indices have runs (from the styled tree) and expose a set.

- [ ] **Step 4: Build and run test**

Run: `npm run build --workspace @typecad/cuttlefish && npx vitest run tests/packages/cuttlefish/inline-runs-lowering.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/cuttlefish/src/ir/ui-element-auto-wire.ts tests/packages/cuttlefish/inline-runs-lowering.test.ts
git commit -m "feat(inline): enforce runs-static-only with diagnostic"
```

---

## Task 10: Showcase example + full verification

**Files:**
- Modify: `demo-ui/src/showcase.ui.html` (add a rich-text paragraph), `demo-ui/src/showcase.neobrutalism.css` (style it)

- [ ] **Step 1: Add a rich-text showcase screen**

Add to `showcase.ui.html` a paragraph exercising mixed inline content:

```html
<screen id="richtext">
  <p style="padding:8px">
    This is a <b>rich text</b> paragraph with <i>italic</i>, <u>underline</u>,
    and a <a href="#home">link home</a>. It wraps across lines with
    <span style="color:#ff0000">colored</span> runs and
    <span style="font-size:24px">bigger</span> text on the same line.
  </p>
</screen>
```

Add a navigation link to it from an existing screen (e.g. home).

- [ ] **Step 2: Style it in the theme**

Add minimal CSS in `showcase.neobrutalism.css` (most styling is inline above for clarity):

```css
#richtext p { color: #ffffff; font-size: 16px; }
#richtext a { color: #66ccff; text-decoration: underline; }
```

- [ ] **Step 3: Build and compile**

Run:
```sh
npm run build --workspace @typecad/cuttlefish
npm run compile --workspace demo-ui
```
Expected: compile succeeds; Flash/RAM within bounds. Fix any compile errors.

- [ ] **Step 4: Run the full test suite**

Run: `npx vitest run`
Expected: only the 6 pre-existing failures (unrelated, from the in-progress `host-ui-runtime.ts`/`preview-gfx` work); no new failures from this feature.

- [ ] **Step 5: Visual check (preview)**

Start the preview (per demo-ui README) and confirm the rich-text screen renders: bold/italic/underline visible, colors per run, the large run taller on its line with baseline alignment, the link navigates on tap, and wrapping respects per-run widths.

- [ ] **Step 6: Commit**

```bash
git add demo-ui/src/showcase.ui.html demo-ui/src/showcase.neobrutalism.css
git commit -m "feat(inline): rich-text showcase example"
```

---

## Self-Review (completed during plan authoring)

**Spec coverage:**
- §2 Parser & Resolver (inline sequence, run absorption, styling-tag defaults, whitespace) → Tasks 1, 2, 3.
- §3 Multi-run layout (layoutRuns, per-line height, baseline) → Task 4.
- §4 Lowering & runtime (model fields, lowering, C++ draw, host draw, link hit-test, auto-wire) → Tasks 5, 6, 7, 8.
- §5 Static-only rule + diagnostics → Task 9.
- §5 Edge cases (empty runs, long runs, br, nested, split runs, alignment, nowrap, per-run size, inheritance, scroll) → covered by Task 4 (layout) and Task 5 (lowering) tests; showcase (Task 10) exercises several visually.
- §5 Testing strategy layers 1-3 → Tasks 1, 3, 4, 5, 6, 7 test files.
- §1 Verification commands → Task 10 Step 3-4.

**Placeholder scan:** No TBD/TODO. Task 8's test stub and Task 9's test stub reference "mirror existing pattern" — these are acceptable because they point to a concrete existing test surface, but the implementer should expand them. Task 4 Step 3 flags the wrap math as intricate and mandates iterating against the tests (the tests are the spec). Task 6 Step 6 has an open sub-decision (absolute vs relative segment x for hit-test) — the implementer picks one and documents it; both are valid.

**Type consistency:** `TextRun` (resolver) defined in Task 3 / run-types.ts; `UITextRunModel` + `RunLines` (model) in Task 5; `LayoutRun` (layout input) in Task 4; `RichSegment`/`RichLine`/`RichLayoutResult` (layout output) in Task 4. C++ `UIRichRun`/`UIRichSeg`/`UIRichLine` in Task 6 mirror the model shapes. `linkTarget` is `number` in TS, `int8_t` in C++ (screen index, -1 sentinel) — consistent. `hardBreak` on TextRun and LayoutRun — consistent.

**One risk to flag:** Task 4's wrap math is the hardest part and the plan's sketch is deliberately rough (the tests pin correctness). If the implementer finds the greedy algorithm needs significant rework, Task 4 may expand; this is the natural place for iteration.
