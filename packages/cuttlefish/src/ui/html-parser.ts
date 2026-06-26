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

export interface UIElementNode {
  tag: string;
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
  children: UIElementNode[];
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

const SUPPORTED_TAGS = new Set(["screen", "text", "button", "view", "check", "select", "option", "label", "radio", "progress", "range", "input", "keyboard", "row", "key", "style", "a", "img", "list", "br"]);

/** Extract <style>...</style> block contents from HTML source.
 *  Returns the concatenated CSS text (empty if no style blocks). */
export function extractStyleBlocks(src: string): string {
  const matches = src.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi);
  return Array.from(matches).map(m => m[1]).join("\n");
}

export function parseHtml(src: string): UIElementNode {
  return parseAllScreens(src)[0];
}

/** Parse all <screen> roots from HTML. Returns one tree per screen.
 *  Used for multi-screen navigation (<a href="#screenId">). */
export function parseAllScreens(src: string): UIElementNode[] {
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

  return screenEls.map(el => domToUIElementNode(el));
}

/** Parse HTML, returning both the <screen> tree and any <keyboard> templates. */
export function parseHtmlWithKeyboards(src: string): ParsedHtml {
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
  const screens = parseAllScreens(src);
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
function domToUIElementNode(el: Element): UIElementNode {
  const tag = el.tagName.toLowerCase();

  // <label> and <a> are treated as <text> internally
  const effectiveTag = (tag === "label" || tag === "a") ? "text" : tag;

  if (!SUPPORTED_TAGS.has(tag)) {
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
  const srcAttr = tag === "img" ? (el.getAttribute("src") || undefined) : undefined;
  const imgWidthAttr = tag === "img" ? parseInt(el.getAttribute("width") || "0", 10) : undefined;
  const imgHeightAttr = tag === "img" ? parseInt(el.getAttribute("height") || "0", 10) : undefined;
  const itemHeightAttr = tag === "list" ? (parseInt(el.getAttribute("item-height") || "24", 10) || 24) : undefined;

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
    return SUPPORTED_TAGS.has(ct) && ct !== "option" && ct !== "br";
  });

  if (childElements.length === 0) {
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

  const node: UIElementNode = { tag: effectiveTag, id, classes, text, value: valueAttr, name: nameAttr, checked: checkedAttr, min: minAttr, max: maxAttr, type: typeAttr, placeholder: placeholderAttr, maxlength: maxlengthNum, keyboard: keyboardAttr, hidden: hiddenAttr, inlineStyle: inlineStyleAttr, href: hrefAttr, src: srcAttr, imgWidth: imgWidthAttr || undefined, imgHeight: imgHeightAttr || undefined, itemHeight: itemHeightAttr, children: [] };
  for (const child of childElements) {
    node.children.push(domToUIElementNode(child));
  }
  return node;
}
