# Inline Text Flow / Rich-Text Runs — Design

**Date:** 2026-07-01
**Status:** Approved (brainstormed with user)
**Scope:** Add an inline formatting context so mixed inline content
(`<p>Hello <b>world</b> <a href="#x">link</a></p>`) flows on shared wrapped lines
with per-run styling, instead of each child becoming its own stacked node.

## Problem

Today a node is strictly `(one text string, one style)`. There is no inline
formatting context anywhere in the system:

- Mixed content like `<p>Hello <b>world</b></p>` is **destructive**: the
  parser's `childElements.length === 0` guard skips text collection when any
  child element exists, so surrounding text is dropped.
- `<b>/<strong>/<i>/<em>/<u>` are unrecognized tags, **dropped** with a warning;
  their text is lost.
- `<span>/<a>` remap to `text` and become **standalone stacked flex children**,
  not flowing runs.
- The wrapping primitive (`text-layout.ts`) operates on one string with one
  `measureText`; it cannot break across run boundaries or measure per-run.
- Both runtimes (C++ `ui_draw_wrapped_text`, host `drawTextLines`) re-wrap at
  draw time from a single `fg`/`textSize`/`fontFace` per node — no per-run style.

## Goal & Non-Goals

**Goal:** Rich-text runs on shared wrapped lines. `<span>/<a>/<b>/<strong>/<i>/<em>/<u>`
flow as styled runs; per-run `color`, `font-weight`/`font-style`, `font-size`,
and `text-decoration`/`text-transform` all vary per run. `<br>` is a hard break.
Inline `<a href>` links are tappable.

**Non-goals (explicitly out of scope):**
- Per-run text bindings (a node with runs cannot have a `PROP_TEXT` binding).
- `float`, `inline-block`, `display: inline-block`.
- Runtime re-flow of runs (run geometry is baked at lower time; run text is static).
- Cross-segment ellipsis re-trimming (a sharp edge, deferred).

## Decisions (locked during brainstorming)

| Decision | Choice | Rationale |
|---|---|---|
| Capability scope | Rich-text runs on shared lines | Solves the core pain; float/inline-block too risky for embedded. |
| Per-run style set | color, font-weight/style, font-size, text-decoration/transform | Full set including font-size (variable line height). |
| Where runs live | On the text node (`runs: TextRun[]`) | Cleanest mapping to "one paragraph = one box"; smallest layout-engine change. |
| Approach | **A — Run-list on text node** | Only approach that delivers per-run rendering + correct wrapping. |
| Inline links | Tappable in v1 via per-run hit-rects | Copy the list-item subdivision precedent. |
| Bindings | Runs are static-only | A node with runs cannot have `PROP_TEXT`; enforced with a diagnostic. |

## Architecture & Data Flow

### The run model

```ts
type TextRun = {
  text: string;                    // literal characters (text-transformed at lower time)
  style: Partial<CSSProperty>;     // inherited-or-overridden keys this run sets
  href?: string;                   // resolved screen target if the run came from <a href>
};
```

A text node carries **either** `runs` (rich text) **or** the existing single
`text`/style — never both. When inline children are present, `runs` wins and
`text` is empty. The existing single-string path is 100% preserved as the
default; `runs` is purely additive.

### Pipeline

```
HTML → Parser → Resolver → Layout → Lowering → Model → Runtime (×2)
```

| Stage | Responsibility for runs |
|---|---|
| **Parser** (`html-parser.ts`) | Recognize `<b>/<strong>/<i>/<em>/<u>` (newly whitelisted). Collect an ordered **inline sequence** of a node's children: bare text nodes, recognized inline elements, `<br>` (hard-break marker). |
| **Resolver** (`style-resolver.ts`) | Absorb the inline sequence into one `runs[]` on the text node. Each run's `style` = parent's resolved style + inline element's matched rules + inheritance. Carry `href` onto link runs. Inline children do **not** become separate `StyledNode`s. |
| **Layout** (`text-layout.ts` + `layout-engine.ts`) | New `layoutRuns` greedy breaker: walks runs, measures each candidate with that run's own `measureText`, breaks at spaces and run boundaries, emits `RichLine[]` with per-segment geometry + per-line height/ascent. |
| **Lowering** (`model.ts`) | New model fields: `runs?: UITextRunModel[]` (pre-resolved fg/textSize/fontFace/underline/linkTarget) and `runLines` (precomputed wrapped-line geometry as struct-of-arrays). |
| **Runtime C++** (`runtime-header.ts`) | `ui_draw_rich_text`: iterates precomputed lines/segments, advancing an x-cursor, per-segment fg/ts/fontFace/underline. Link hit-test sub-tests `runLines` segments; calls `ui_navigate`. |
| **Runtime host** (`host-ui-runtime.ts`) | Mirror: `drawRichNode`, same per-segment draw, same run-rect hit-test. |

### Two safety properties

1. **Runs are opt-in.** A plain `<text>foo</text>` or `<p>foo</p>` with no inline
   children takes the existing path unchanged — `runs` absent, all existing
   tests and behavior hold. Only mixed inline content enters the new path.

2. **One shared breaker drives both runtimes.** `layoutRuns` lives in
   `text-layout.ts` (shared TS); its output is baked into the model as both the
   segment geometry and the run hit-rects. The C++ runtime consumes the
   **precomputed** geometry — it does **not** re-implement run wrapping at draw
   time (unlike today's single-string `ui_text_next_line`, which re-wraps).

   **Trade-off:** precomputed geometry means a run node's box width is fixed at
   lower time (cannot re-flow at runtime). Acceptable because runs are
   static-content only (no bindings), so the text never changes at runtime.

## Section 2: Parser & Resolver

### Which elements are "inline"

```ts
// Tags whose content participates in inline flow when they're children of a
// text container. Bare text nodes between them flow too.
const INLINE_TAGS = new Set([
  "span", "a",                   // already remap to text
  "b", "strong", "i", "em", "u", // newly recognized (bold/italic/underline)
]);
```

`b/strong/i/em/u` are added to `TAG_REMAP` mapping to `text` (so they're
recognized, not dropped), and carry `origTag` the resolver uses to derive a
default style. `<br>` is **not** an inline element — it's a hard-break marker
emitted into the inline sequence.

### Parser: collect an inline sequence

The choke point is `html-parser.ts:300` (`if (childElements.length === 0)`).
The change:

1. A node is **inline-bearing** if its effective tag is `text` **and** its
   `childNodes` contain a mix of text nodes and/or recognized inline elements
   (scanned via `childNodes`, since text nodes aren't in `el.children`).
2. When inline-bearing, walk `childNodes` in document order building:
   - text node (nodeType 3) → push a text fragment
   - `<span>/<a>/<b>/<strong>/<i>/<em>/<u>` → recurse (style attrs + nested inline)
   - `<br>` → push a hard-break marker
3. Store as a new `UIElementNode.inline?: InlineItem[]` field:
   ```ts
   type InlineItem =
     | { kind: "text"; text: string }
     | { kind: "element"; tag: string; origTag?: string; classes: string[];
         inlineStyle?: string; href?: string; inline?: InlineItem[] }
     | { kind: "break" };
   ```
4. The node's `text`/`children` are empty when `inline` is present. Non-inline
   children of a `text` node (e.g. a `<view>` nested in a `<p>`) still go
   through `children`; if both inline content and block children exist, the
   block children win and the inline content is dropped with a diagnostic.

The existing no-children text path is unchanged; `inline` is only populated for
genuinely mixed content.

### Resolver: absorb the sequence into runs

In `resolveNode`, after computing the node's own `style`, if the source node has
`inline`:

1. Resolve each `element` item's style by matching its selector (class/origTag/
   inlineStyle) against the cascade, then layering inheritance on top of the
   **parent text node's** resolved style (reusing `INHERITED_KEYS`). Styling
   tags get an implicit low-priority default: `b/strong` → `fontWeight: "bold"`,
   `i/em` → `fontStyle: "italic"`, `u` → `textDecoration: "underline"`.
2. Flatten the nested inline tree into a flat `runs: TextRun[]` in document
   order, splicing nested sequences inline. Each run carries the most-specific
   style at that point (inner overrides outer via last-wins cascade).
3. `<br>` → `{ text: "\n", hardBreak: true }` (sentinel for the wrapper).
4. Carry `href` from `<a>` items onto their runs.
5. Set `node.runs`, leave `node.text` empty. Inline children do **not** produce
   separate `StyledNode`s.

### Whitespace normalization

Bare text between inline elements keeps surrounding whitespace. The existing
`text-layout.ts` `normalizeText` collapses whitespace per the node's
`white-space` mode; the breaker reuses it but normalizes **within each run's
text** and collapses at run boundaries (a run starting with a space that
follows a run ending in a space collapses to one). Detail deferred to the
implementation plan.

### What this section does NOT change

- Non-text containers (`view`, `div`, `header`, …) are unaffected.
- A text node with no inline content keeps the single-`text` path.
- The destructive `<b>` drop is fixed as a side effect.

## Section 3: Multi-run Layout (`layoutRuns`)

### Challenge

Per-run style means each run has its own advance width (bold wider, larger
font-size taller). The breaker must: measure per-run; break at spaces **and**
run boundaries; track per-segment geometry; compute per-line height as the
tallest run; align runs on a common baseline.

### Types

```ts
export interface RichSegment {
  runIndex: number;   // source run this segment came from
  text: string;       // normalized text
  x: number;          // offset from the line's left edge (pre-alignment)
  width: number;      // measured width at this run's style
}
export interface RichLine {
  segments: RichSegment[];
  width: number;      // sum of segment widths + inter-segment spaces
  height: number;     // tallest run height on this line
  ascent: number;     // tallest ascent (for baseline alignment)
}
export interface RichLayoutResult {
  lines: RichLine[];
  width: number;      // max line width
  height: number;     // sum of line heights
}
```

### Signature

```ts
export function layoutRuns(
  runs: { text: string; hardBreak?: boolean;
          measureText: (s: string) => number; height: number; ascent: number }[],
  options: { maxWidth?: number; whiteSpace?: string }
): RichLayoutResult
```

Each run carries its own `measureText` (closing over the run's font/size via
the existing `assetTextWidth`/`textWidthOf`) plus `height`/`ascent` (GFX
`8*textSize` / `7*textSize`; asset fonts use `UIFontAssetModel.lineHeight` /
`baseline`).

### Algorithm (greedy, generalizes `wrapParagraph`)

1. **Tokenize each run into words** (split on spaces, tracking leading/trailing
   spaces). A `hardBreak` run flushes the current line.
2. **Walk the token stream**, accumulating onto the current line. Measure each
   candidate token with **its own run's** `measureText`. **Inter-word space
   ownership:** a space belongs to the run whose text contains it — so the
   space's width is measured with that run's `measureText`. (A space at a run
   boundary, i.e. trailing space of run A immediately followed by leading space
   of run B, is collapsed to a single space per the whitespace normalization
   rule in step 5, and measured with run A's advance as the "owning" run.)
3. **Break decision:** if adding the next token (plus separator space) exceeds
   `maxWidth`, flush the line and start a new one. A single token alone
   exceeding `maxWidth` uses the existing `splitLongWord` logic generalized to
   that run's `measureText`.
4. **Line height/ascent on flush:** `line.height = max(segment.height)`,
   `line.ascent = max(segment.ascent)`.
5. **Whitespace:** normalize across run boundaries as `normalizeText` does
   today, but per-run. `white-space` modes reuse the existing `whiteSpaceMode`
   enum: `nowrap` (one line), `pre` (preserve whitespace, break on `\n` only),
   `pre-line` (collapse spaces, keep `\n`).
6. **Segment geometry:** as tokens are placed, record each segment's `x`
   (running cursor) and `width`. A run splitting across two lines produces two
   segments with the same `runIndex`.

### Vertical metrics

- **Line content height** (`line.height`): tallest run on the line.
- **`line-height` CSS** (`lineHeightOf`): explicit multiplier/pixel value.

If the node has explicit `line-height`, that wins for cursor advance (uniform
lines, current behavior preserved). If not, cursor advance = tallest content
run on the line (new for runs; collapses to old behavior for single-style).
This keeps single-style paragraphs pixel-identical to today.

### Baseline alignment

Runs of different `font-size` on a line align on a common baseline, not on top
edges. Each line's baseline = `lineY + line.ascent`. Each segment drawn at
`baseline − segment.ascent` (its own top). Standard inline-layout behavior.

### Flex measurement integration

`measure()` in `layout-engine.ts` for a run-bearing node calls `layoutRuns`
instead of `layoutText`, returning `{ w: layout.width, h: layout.height }`. The
yoga `setMeasureFunc` for a run-bearing node uses this, so the node's box sizes
to the rich text. `block-layout.ts` is unaffected.

### What this section does NOT change

- Single-string text nodes keep `layoutText` exactly.
- `nowrap`/`pre`/`pre-line` preserved.
- `text-overflow: ellipsis` — known limitation: applied per-line to the last
  visible segment using current truncation logic. Full run-aware re-trimming
  deferred.

## Section 4: Lowering to Model & Runtime Draw

### Model additions (`UINodeModel`)

Optional, so existing nodes are byte-for-byte unchanged:

```ts
export interface UITextRunModel {
  text: string;        // text-transformed, normalized
  fg: number;          // resolved RGB565
  textSize: number;    // GFX size 1-4 (from run font-size + font-weight)
  fontFace: number;    // asset id, 0 = classic GFX font
  underline: number;   // 0/1/2/3 (text-decoration)
  letterSpacing: number;
  linkTarget: number;  // resolved screen index, or -1 = not a link
}
```

On `UINodeModel`:
```ts
  runs?: UITextRunModel[];
  runLines?: {                        // precomputed wrapped-line geometry
    segRun: number[]; segText: string[]; segX: number[]; segW: number[];
    segLine: number[]; lineY: number[]; lineH: number[];
    lineBaseline: number[]; lineW: number[];
  };
```

**Struct-of-arrays for `runLines`:** C++ emits these as parallel arrays —
keeping TS in the same shape makes the lowering-to-C++ mapping trivial and
mirrors the existing model's use of parallel arrays
(`shadowOffsetX/Y/...`). Segment `i` is
`(segRun[i], segText[i], segX[i], segW[i], segLine[i])`.

### Lowering (`lowerUIToModel`)

For a run-bearing node:

1. Resolve each run's `fg`/`textSize`/`fontFace`/`underline`/`letterSpacing`
   via existing helpers applied to the **run's** style.
2. Apply `text-transform` per run.
3. Resolve `linkTarget` per run via existing `resolveScreenHref` → screen index,
   else `-1`. Unresolved hrefs warn and degrade to `-1`.
4. Run `layoutRuns` once at lower time (node's resolved box width as
   `maxWidth`), capturing `RichLine[]` into `runLines` struct-of-arrays. Run
   hit-rects are derived directly from `runLines` (segments with
   `segRun === linkRunIndex` → `{x: segX, y: lineY, w: segW, h: lineH}`), so no
   separate storage.
5. Leave `text`/`textBuffer` empty, `hasTextBinding: false`. **Enforce
   static-only:** if a `PROP_TEXT` binding targets a node with `runs`, emit a
   diagnostic and drop the binding.
6. Node's own `textSize`/`fg`/`fontFace` set from the **first run**. These are
   not used by the rich draw path (which reads per-segment run params), but
   keep legacy/box-sizing reads sane and give the node a sensible fallback if
   something reads node-level text fields.

### Runtime draw — shared shape

Both runtimes get `drawRichText` consuming precomputed `runLines` (they do
**not** re-wrap). Per line:

1. Compute x-origin from `textAlign` and `lineW[i]` (reuse `lineX` math).
2. Per segment: look up run (`runs[segRun[i]]`), draw `segText[i]` at
   `(lineOriginX + segX[i], lineBaseline[i] − run.ascent)` with the run's
   `fg`/`textSize`/`fontFace`/`letterSpacing`. Baseline alignment means the
   segment's top varies by run ascent.
3. Underline/strikethrough per run, drawn under just that segment's width.
4. Text-shadow two-pass (if `textShadowCount > 0`): draw the whole rich block
   offset by the shadow offset in the blended shadow color, before the main
   pass — reusing the existing two-pass shadow pattern.

### C++ runtime (`runtime-header.ts`)

- New `ui_draw_rich_text(nodeIndex)` reads `__ui_nodes[i].runLines.*` and
  `__ui_nodes[i].runs[]`, calls `ui_draw_text` per segment with the segment's
  run params. **No new wrap algorithm in C++** — consumes precomputed geometry.
- `NODE_TEXT` draw case: if `__ui_nodes[i].runCount > 0`, call
  `ui_draw_rich_text`; else existing `ui_draw_wrapped_text`. Only change to the
  text draw dispatch.
- **Link hit-test:** in `ui_touch_up`, after `ui_hit_test` returns the
  paragraph node index, if that node has runs with `linkTarget >= 0`, compute
  the tap point in node-local coordinates (subtract `ui_draw_x/y_for_node`)
  and scan `runLines` segments belonging to link runs; if the point falls
  within a link run segment's rect, dispatch via `ui_navigate(run.linkTarget)`.
  Copies the list-item subdivision precedent with measured run rects.

### Host runtime (`host-ui-runtime.ts`)

Mirror: `drawRichNode(node)` reading `node.runLines`/`node.runs`, drawing per
segment with the host's `drawText`. `drawTextNode`: if `node.runs`, branch to
`drawRichNode`; else existing `drawTextLines`. Hit-test: `hitTest` returns the
paragraph node; the paragraph's click dispatch sub-tests against `runLines`
link segments in node-local space and calls `ui.navigate(run.linkTarget)`.

### Auto-wire change (`ui-element-auto-wire.ts`)

Existing link auto-wire keys off `node.href` per node. For run-bearing nodes
there's no single `href` — runs carry per-run `linkTarget`. Change: when
auto-wiring, if a node has runs, register **one click handler** against the
node index (so the node is hit-testable); the handler body is a synthetic
sub-dispatch that consults the run hit-rects. Per-run targets are already baked
into `runs[].linkTarget`, so the handler reads `__ui_nodes[i].runs[]` at tap
time — no per-run callbacks needed.

### What this section does NOT change

- Single-string text nodes keep `ui_draw_wrapped_text` / `drawTextLines`.
- Bindings on non-run nodes are unaffected.
- The C++ re-wrap-at-draw path survives for single-string nodes; only run nodes
  use precomputed geometry.

## Section 5: Error Handling, Edge Cases & Testing

### Diagnostics (warnings, never fatal)

| Code | Trigger | Behavior |
|---|---|---|
| `inline-content-mixed-with-block` | A `<text>`/`<p>` has both inline content AND block children | Drop inline, keep block children, warn. Matches browser behavior. |
| `run-text-binding-conflict` | A node with `runs` is targeted by a `PROP_TEXT` binding | Drop the binding, keep runs (static), warn. |
| `inline-link-target-unresolved` | An `<a href="#x">` run's `#x` doesn't match a screen id | Run renders as styled text; `linkTarget = -1` (not tappable), warn. |
| `unknown-html-tag` | (existing) `<b>/<strong>/<i>/<em>/<u>` no longer trigger this | These tags are now recognized. No regression for other unknown tags. |

All diagnostics follow the existing
`{ severity: "warning", message, hint, code, source }` shape.

### Edge cases

1. **Empty / whitespace-only runs** produce no segments; an all-whitespace
   paragraph renders as zero-height (matches today).
2. **Single run longer than the box** → `splitLongWord` generalized to per-run
   measurement breaks it across lines (matches today).
3. **`<br>` at start/end or consecutive** → each hard-break flushes the line
   (empty if needed → blank line). Two consecutive `<br>`s → one blank line
   between text. Matches HTML.
4. **Nested inline of the same kind** (`<b>a <b>b</b></b>`) → idempotent
   re-assert. Nested different kinds (`<b>bold <i>both</i></b>`) → inner run's
   style is the merge of outer bold + inner italic.
5. **A run splitting across many lines** → multiple segments, same `runIndex`.
   Hit-test union handles multi-line links (tapping any segment navigates).
6. **`text-align: center/right`** → per-line from `lineW[i]`, applied to the
   whole line block. Matches today.
7. **`white-space: nowrap` with runs** → one line; overflow past the right edge
   (today's behavior). `text-overflow: ellipsis` truncates the last visible
   segment (cross-segment re-trimming deferred).
8. **Per-run `font-size` making a line taller** → line height = tallest run
   only where the large run sits.
9. **CSS inheritance interaction** → runs inherit from the parent text node via
   `INHERITED_KEYS`; `<p style="color:red">Hello <b>world</b></p>` makes "world"
   red unless the `<b>` run sets its own color.
10. **Rich text inside scroll containers** → a run-bearing node is just a leaf
    with a box; scroll machinery operates on `box`. `runLines` is in node-local
    space, so scrolling translates the whole node correctly.

### Testing strategy

Three layers, matching repo conventions (inline-literal HTML+CSS,
`.style.<prop>` assertions; `resolveStyles(parseHtml(...), [])` for UA; full
`lowerUIToModel`/preview snapshot tests):

**Layer 1 — Parser/resolver unit tests** (`inline-runs.test.ts`):
- `<p>Hello <b>world</b></p>` → one node, 2 runs (`"Hello "`, `"world"` bold),
  no separate child nodes.
- `<b>/<strong>` → bold; `<i>/<em>` → italic; `<u>` → underline (defaults).
- Nested inline `<b>a <i>b</i></b>` → runs with merged style.
- `<a href="#x">` run carries resolved `linkTarget` and `href`.
- `<br>` between runs → hard-break run; produces a line break in layout.
- Surrounding whitespace preserved: `<p>Hello <b>x</b>!</p>` → 3 runs.
- Plain `<text>foo</text>` (no inline) → `runs` absent, `text: "foo"`
  (regression guard).
- Mixed inline + block child → inline dropped, warning emitted.

**Layer 2 — Layout tests** (`text-layout.test.ts` extended):
- `layoutRuns` with equal-style runs wraps identically to `layoutText`
  (regression equivalence for single-style case).
- A bold run mid-line is wider; break point respects per-run measurement.
- Per-run `font-size` → the line with the larger run is taller; baseline
  alignment places smaller runs on the same baseline.
- `<br>` forces a line break; consecutive `<br>`s blank a line.
- `white-space: nowrap` → one line; `pre` → preserves spaces and breaks on `\n`
  only.

**Layer 3 — Lowering & runtime tests** (`inline-runs-lowering.test.ts` +
runtime-header string assertion):
- A run-bearing node lowers to `runs[]` + `runLines` struct-of-arrays; a
  non-run node has neither (regression guard).
- `runLines` geometry: segment x-offsets accumulate; line widths sum; a split
  run has two segments with the same `runIndex`.
- Link run → `linkTarget` is the resolved screen index; non-link run → `-1`.
- `PROP_TEXT` binding on a run node → binding dropped,
  `run-text-binding-conflict` diagnostic.
- **Preview/C++ parity:** a focused test that builds a run-bearing node, lowers
  it, and asserts the host `drawRichNode` and the emitted C++
  `ui_draw_rich_text` consume the *same* `runLines` geometry (the AGENTS.md
  "preview and runtime agree" check).
- Runtime-header string assertion (mirroring `runtime-header.test.ts`'s
  `expect(header).toContain(...)` pattern): the C++ contains `ui_draw_rich_text`
  and the link hit-test branch.

### Verification (per AGENTS.md)

```sh
npm run build --workspace @typecad/cuttlefish
npx vitest run tests/packages/cuttlefish/runtime-header.test.ts
npx vitest run tests/packages/cuttlefish/inline-runs.test.ts
npx vitest run   # full suite — expect the same 6 pre-existing failures, no new ones
npm run compile --workspace demo-ui
```

The demo-ui showcase will gain a rich-text example screen (or extend an
existing `<p>`) to exercise the feature end-to-end, ensuring the showcase
compiles and the preview renders multi-style paragraphs.

## Open Questions

None. All decisions locked during brainstorming. Cross-segment ellipsis
re-trimming and per-run bindings are explicitly deferred non-goals.
