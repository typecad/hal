// ---------------------------------------------------------------------------
// HTML parser — uses linkedom for robust DOM parsing, then adapts to the
// UIElementNode shape that the rest of the pipeline expects.
//
// Supported subset:
//   - One <screen> root (required, exactly one).
//   - Child elements: <text>, <button>, <view> (a generic container).
//   - Attributes: id="...", class="a b".
//   - Text content of leaf elements.
//
// The public API (parseHtml: string → UIElementNode) is unchanged — callers
// don't know whether linkedom or a regex parser is behind it.
// ---------------------------------------------------------------------------

import { parseHTML } from "linkedom";
import type { Diagnostic } from "../types.js";
import { collectInlineSequence, INLINE_TAGS, InlineItem } from "./inline-parser.js";

export interface UIElementNode {
  tag: string;
  /** Original HTML tag before remapping (label/a/div/...), so CSS tag
   *  selectors still match remapped elements. Equals tag when no remap. */
  origTag?: string;
  id?: string;
  classes: string[];
  text?: string;
  /** Value attribute (for <option>, <radio>). */
  value?: string;
  /** Name attribute (for <radio>: groups radios together). */
  name?: string;
  /** Checked attribute (for <radio>: initially selected). */
  checked?: boolean;
  /** Min/max attributes (for <range>). */
  min?: string;
  max?: string;
  /** Input type (for <input>: "text" | "number"). */
  type?: "text" | "number";
  /** Placeholder (for <input>). */
  placeholder?: string;
  /** Max length (for <input>). */
  maxlength?: number;
  /** Keyboard ref id (for <input>). */
  keyboard?: string;
  /** HTML hidden attribute: removes the element subtree from layout/rendering. */
  hidden?: boolean;
  /** Inline style attribute: style="color: red; font-size: 16px" */
  inlineStyle?: string;
  /** Navigation target for <a href="#screenId"> links. */
  href?: string;
  /** Image source path for <img src="...">. */
  src?: string;
  /** Image width in pixels (for <img>). */
  imgWidth?: number;
  /** Image height in pixels (for <img>). */
  imgHeight?: number;
  /** Item height in pixels (for <list item-height="24">). */
  itemHeight?: number;
  /** Canvas buffer width in pixels (for <canvas>). */
  canvasW?: number;
  /** Canvas buffer height in pixels (for <canvas>). */
  canvasH?: number;
  
  /** Disabled state */
  disabled?: boolean;
  children: UIElementNode[];
  /** Ordered inline content sequence (text/element/break items). Present only
   *  for text nodes with mixed inline children; absent for plain-text nodes. */
  inline?: InlineItem[];
  /** True when the text content contains a `{expr}` interpolation, which the
   *  auto-wire layer lowers to an implicit ui.bind(node,'text',...) text
   *  binding. Plain text (no braces) is unchanged. */
  hasInterpolation?: boolean;
  /** Declarative event handlers from on:* attributes (e.g. on:click="save").
   *  Keys: click | hold | release | change. Values: a named TS export function
   *  the transpiler emits as a standalone C++ function; the handler table
   *  references it by name. Absent when no on:* attributes are present. */
  events?: { click?: string; hold?: string; release?: string; change?: string };
  /** Declarative two-way bindings from bind:* attributes (e.g. bind:text="ssid").
   *  Keys: text | value. Values: a signal name — the node reflects the signal
   *  (one-way: signal → node), and user input writes back (node → signal.set).
   *  Absent when no bind:* attributes are present. */
  bind?: { text?: string; value?: string };
  /** For <select>: parsed option list from <option> children. */
  options?: Array<{ value: string; text: string }>;
}

/** A single key in a keyboard template. */
export interface UIKeyTemplate {
  /** Character to insert, or label for special keys. */
  ch: string;
  /** 0=char, 1=shift, 2=backspace, 3=ok, 4=page-swap. */
  special: 0 | 1 | 2 | 3 | 4;
  /** CSS classes from <key class="..."> for styling. */
  classes?: string[];
}

/** A keyboard template parsed from <keyboard>. */
export interface KeyboardTemplate {
  id: string;
  variant: "alpha" | "number";
  rows: UIKeyTemplate[][];
  /** CSS classes from <keyboard class="..."> for styling the keyboard background. */
  classes?: string[];
}

export interface ParsedHtml {
  /** The first <screen> tree (backward compat). */
  tree: UIElementNode;
  /** All <screen> roots (for multi-screen navigation). */
  screens: UIElementNode[];
  keyboards: KeyboardTemplate[];
}

const SUPPORTED_TAGS = new Set(["screen", "text", "button", "view", "check", "select", "option", "label", "radio", "progress", "range", "input", "keyboard", "row", "key", "style", "a", "img", "list", "canvas", "br"]);

/** HTML tag aliases — common HTML elements remapped to internal primitives.
 *  Semantic block containers -> view; inline/heading text tags -> text.
 *  Applied before the SUPPORTED_TAGS check so authors can write familiar HTML. */
const TAG_REMAP: Record<string, string> = {
  // Block-level containers -> view (flexbox/positioning surface)
  body: "view", div: "view", header: "view", footer: "view", nav: "view",
  main: "view", section: "view", article: "view", aside: "view",
  // Inline/heading text -> text
  span: "text", p: "text",
  h1: "text", h2: "text", h3: "text", h4: "text", h5: "text", h6: "text",
  // Styling tags -> text (inline; resolver applies bold/italic/underline defaults
  // and absorbs them into the parent's run list).
  b: "text", strong: "text", i: "text", em: "text", u: "text",
};

/** Extract <style>...</style> block contents from HTML source.
 *  Returns the concatenated CSS text (empty if no style blocks). */
export function extractStyleBlocks(src: string): string {
  const matches = src.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi);
  return Array.from(matches).map(m => m[1]).join("\n");
}

export function parseHtml(src: string, diagnostics?: Diagnostic[]): UIElementNode {
  return parseAllScreens(src, diagnostics)[0];
}

/** Parse all <screen> roots from HTML. Returns one tree per screen.
 *  Used for multi-screen navigation (<a href="#screenId">). */
export function parseAllScreens(src: string, diagnostics?: Diagnostic[]): UIElementNode[] {
  const withoutComments = src.replace(/<!--[\s\S]*?-->/g, "").replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "");

  const wrapped = `<div id="__root__">${withoutComments}</div>`;
  const { document } = parseHTML(wrapped);
  const root = document.getElementById("__root__");
  if (!root) {
    throw new Error("UI HTML: failed to parse document");
  }

  const screenEls = Array.from(root.children).filter(
    (c) => c.tagName.toLowerCase() === "screen",
  );

  if (screenEls.length === 0) {
    throw new Error("UI HTML must have at least one <screen> root element");
  }

  return screenEls.map(el => domToUIElementNode(el, diagnostics));
}

/** Parse HTML, returning both the <screen> tree and any <keyboard> templates. */
export function parseHtmlWithKeyboards(src: string, diagnostics?: Diagnostic[]): ParsedHtml {
  const withoutComments = src.replace(/<!--[\s\S]*?-->/g, "").replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "");
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

  // Parse all screens (for multi-screen navigation) + keyboards.
  const screens = parseAllScreens(src, diagnostics);
  const tree = screens[0];
  return { tree, screens, keyboards };
}

/** Parse a <keyboard> element into a KeyboardTemplate. */
function parseKeyboardElement(el: Element): KeyboardTemplate {
  const id = el.getAttribute("id") || "";
  const variantAttr = el.getAttribute("variant");
  const variant: "alpha" | "number" = variantAttr === "number" ? "number" : "alpha";
  const classAttr = el.getAttribute("class") || "";
  const classes = classAttr.split(/\s+/).filter(Boolean);
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
  return { id, variant, rows, classes: classes.length > 0 ? classes : undefined };
}

/** Parse a <key> element. Special keys are identified by label or special attr. */
function parseKeyElement(el: Element): UIKeyTemplate {
  const label = el.textContent?.trim() || "";
  const classAttr = el.getAttribute("class") || "";
  const classes = classAttr.split(/\s+/).filter(Boolean);
  const specialAttr = el.getAttribute("special");
  let special: 0 | 1 | 2 | 3 | 4 = 0;
  if (specialAttr !== null) {
    const s = parseInt(specialAttr, 10);
    if (s >= 1 && s <= 4) special = s as 1 | 2 | 3 | 4;
  } else {
    // Recognize special keys by conventional labels.
    if (label === "⇧" || label.toUpperCase() === "SHIFT") special = 1;
    else if (label === "⌫" || label.toUpperCase() === "BACKSPACE") special = 2;
    else if (label.toUpperCase() === "OK") special = 3;
    else if (label === "123" || label.toUpperCase() === "ABC") special = 4;
  }
  return { ch: label, special, classes: classes.length > 0 ? classes : undefined };
}

/** Adapt a DOM element to UIElementNode, recursively walking children. */
function domToUIElementNode(el: Element, diagnostics?: Diagnostic[]): UIElementNode {
  const tag = el.tagName.toLowerCase();

  // <label> and <a> are treated as <text> internally; HTML aliases
  // (div/header/span/p/h1-h6/...) remap to view or text.
  const remapped = TAG_REMAP[tag];
  const effectiveTag = remapped ? remapped
    : (tag === "label" || tag === "a") ? "text" : tag;

  if (!SUPPORTED_TAGS.has(effectiveTag)) {
    throw new Error(`Unsupported tag <${tag}> — supported: ${[...SUPPORTED_TAGS].join(", ")}`);
  }

  const id = el.getAttribute("id") || undefined;
  const classAttr = el.getAttribute("class") || "";
  const classes = classAttr.split(/\s+/).filter(Boolean);
  const valueAttr = el.getAttribute("value") || undefined;
  const nameAttr = el.getAttribute("name") || undefined;
  const checkedAttr = el.hasAttribute("checked");
  const minAttr = el.getAttribute("min") || undefined;
  const maxAttr = el.getAttribute("max") || undefined;
  const typeAttr = tag === "input"
    ? (el.getAttribute("type") === "number" ? "number" : "text")
    : undefined;
  const placeholderAttr = el.getAttribute("placeholder") || undefined;
  const maxlengthAttr = el.getAttribute("maxlength");
  // <input> defaults maxlength to 16 when absent or unparseable.
  const maxlengthNum = tag === "input"
    ? (maxlengthAttr ? (parseInt(maxlengthAttr, 10) || 16) : 16)
    : undefined;
  const keyboardAttr = el.getAttribute("keyboard") || undefined;
  const hiddenAttr = el.hasAttribute("hidden");
  const inlineStyleAttr = el.getAttribute("style") || undefined;
  const hrefAttr = (tag === "a" || tag === "button") ? (el.getAttribute("href") || undefined) : undefined;

  // Declarative on:* event attributes → named-function references. Each value
  // names an exported TS function the transpiler emits as a standalone C++ fn;
  // the click-handler table references it by name (no inlined body).
  const EVENT_KINDS = ["click", "hold", "release", "change"] as const;
  const events: { click?: string; hold?: string; release?: string; change?: string } = {};
  for (const kind of EVENT_KINDS) {
    const v = el.getAttribute(`on:${kind}`);
    if (v && v.trim()) events[kind] = v.trim();
  }
  const hasEvents = Object.keys(events).length > 0;

  // Declarative bind:* two-way bindings → signal names. bind:text on <input>
  // composes a text binding (signal→text) with an input binding (text→signal).
  // bind:value on <range>/<check> composes a value binding with a change handler.
  const BIND_KINDS = ["text", "value"] as const;
  const bind: { text?: string; value?: string } = {};
  for (const kind of BIND_KINDS) {
    const v = el.getAttribute(`bind:${kind}`);
    if (v && v.trim()) bind[kind] = v.trim();
  }
  const hasBind = Object.keys(bind).length > 0;
  const srcAttr = tag === "img" ? (el.getAttribute("src") || undefined) : undefined;
  const imgWidthAttr = tag === "img" ? parseInt(el.getAttribute("width") || "0", 10) : undefined;
  const imgHeightAttr = tag === "img" ? parseInt(el.getAttribute("height") || "0", 10) : undefined;
  const itemHeightAttr = tag === "list" ? (parseInt(el.getAttribute("item-height") || "24", 10) || 24) : undefined;
  const canvasWAttr = tag === "canvas" ? (parseInt(el.getAttribute("width") || "0", 10) || 0) : undefined;
  const canvasHAttr = tag === "canvas" ? (parseInt(el.getAttribute("height") || "0", 10) || 0) : undefined;
  const disabledAttr = el.hasAttribute("disabled");

  // For <select>, parse <option> children into an options list
  if (tag === "select") {
    const optionEls = Array.from(el.children).filter(c => c.tagName.toLowerCase() === "option");
    if (optionEls.length > 0) {
      const options = optionEls.map(opt => ({
        value: opt.getAttribute("value") || opt.textContent?.trim() || "",
        text: opt.textContent?.trim() || "",
      }));
      // Use the first option's text as the initial display text
      const firstText = options[0]?.text ?? "";
      return {
        tag: "select",
        id, classes, text: firstText, value: valueAttr,
        hidden: hiddenAttr,
        inlineStyle: inlineStyleAttr,
        children: [],
        options,
      };
    }
    // Fallback: comma-separated text (legacy shorthand)
    const text = el.textContent?.trim() || "";
    const optNames = text.split(",").map(s => s.trim()).filter(Boolean);
    return {
      tag: "select",
      id, classes, text: optNames[0] || "",
      hidden: hiddenAttr,
      inlineStyle: inlineStyleAttr,
      children: [],
      options: optNames.map(t => ({ value: t.toLowerCase(), text: t })),
    };
  }

  // Text content: only direct text, not children's text.
  let text: string | undefined;
  const childElements = Array.from(el.children).filter((c) => {
    const ct = c.tagName.toLowerCase();
    // Accept native tags and HTML aliases (div/span/p/h1-h6/...) that remap later.
    const accepted = SUPPORTED_TAGS.has(ct) || TAG_REMAP[ct] !== undefined;
    if (!accepted && ct !== "option" && ct !== "br" && diagnostics) {
      diagnostics.push({
        severity: "warning",
        message: `Unknown HTML tag <${ct}> — ignored.`,
        hint: `Supported tags: ${[...SUPPORTED_TAGS].sort().join(", ")}.`,
        code: "unknown-html-tag",
        source: ct,
      });
    }
    return accepted && ct !== "option" && ct !== "br";
  });

  // Inline-bearing text nodes collect an ordered inline sequence instead of a
  // single text string. Only effective-tag "text" can be inline-bearing;
  // collectInlineSequence returns undefined for plain text or block-child nodes.
  let inline: InlineItem[] | undefined;
  if (effectiveTag === "text") {
    inline = collectInlineSequence(el, diagnostics ?? []);
  }

  // Text content: only direct text, and only when there's no inline sequence
  // (inline content is captured above; the plain-text path is unchanged).
  let hasInterpolation = false;
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
    if (tc) {
      text = tc;
      // Detect a `{expr}` interpolation (non-empty content between braces).
      // Inline + interpolation is rejected later by the run-text-binding guard.
      hasInterpolation = /\{[^{}]+\}/.test(tc);
    }
  }

  const remappedFrom = (remapped || tag === "label" || tag === "a") && tag !== effectiveTag ? tag : undefined;
  const node: UIElementNode = { tag: effectiveTag, origTag: remappedFrom, id, classes, text, value: valueAttr, name: nameAttr, checked: checkedAttr, min: minAttr, max: maxAttr, type: typeAttr, placeholder: placeholderAttr, maxlength: maxlengthNum, keyboard: keyboardAttr, hidden: hiddenAttr, inlineStyle: inlineStyleAttr, href: hrefAttr, src: srcAttr, imgWidth: imgWidthAttr || undefined, imgHeight: imgHeightAttr || undefined, itemHeight: itemHeightAttr, canvasW: canvasWAttr, canvasH: canvasHAttr, disabled: disabledAttr, inline, hasInterpolation, events: hasEvents ? events : undefined, bind: hasBind ? bind : undefined, children: [] };
  for (const child of childElements) {
    // Inline children are absorbed into `inline`; don't also emit them as nodes.
    if (inline && INLINE_TAGS.has(child.tagName.toLowerCase())) continue;
    node.children.push(domToUIElementNode(child, diagnostics));
  }
  return node;
}
