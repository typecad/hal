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
  children: UIElementNode[];
  /** For <select>: parsed option list from <option> children. */
  options?: Array<{ value: string; text: string }>;
}

const SUPPORTED_TAGS = new Set(["screen", "text", "button", "view", "check", "select", "option", "label", "radio"]);

export function parseHtml(src: string): UIElementNode {
  // Strip HTML comments before parsing.
  const withoutComments = src.replace(/<!--[\s\S]*?-->/g, "");

  // linkedom follows the HTML spec which hoists unknown elements out of <body>.
  // Wrap the custom-tag HTML inside a <div> so the parser keeps the tree intact.
  const wrapped = `<div id="__root__">${withoutComments}</div>`;
  const { document } = parseHTML(wrapped);
  const root = document.getElementById("__root__");
  if (!root) {
    throw new Error("UI HTML: failed to parse document");
  }

  // Find the <screen> element among the root's children.
  const screenEl = Array.from(root.children).find(
    (c) => c.tagName.toLowerCase() === "screen",
  );

  if (!screenEl) {
    throw new Error("UI HTML must have exactly one <screen> root element");
  }

  // Check for multiple top-level <screen> elements.
  const screens = Array.from(root.children).filter(
    (c) => c.tagName.toLowerCase() === "screen",
  );
  if (screens.length > 1) {
    throw new Error("UI HTML must have exactly one top-level <screen> element");
  }

  const tree = domToUIElementNode(screenEl);
  return tree;
}

/** Adapt a DOM element to UIElementNode, recursively walking children. */
function domToUIElementNode(el: Element): UIElementNode {
  const tag = el.tagName.toLowerCase();

  // <label> is treated as <text> internally
  const effectiveTag = tag === "label" ? "text" : tag;

  if (!SUPPORTED_TAGS.has(tag)) {
    throw new Error(`Unsupported tag <${tag}> — supported: ${[...SUPPORTED_TAGS].join(", ")}`);
  }

  const id = el.getAttribute("id") || undefined;
  const classAttr = el.getAttribute("class") || "";
  const classes = classAttr.split(/\s+/).filter(Boolean);
  const valueAttr = el.getAttribute("value") || undefined;
  const nameAttr = el.getAttribute("name") || undefined;
  const checkedAttr = el.hasAttribute("checked");

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
      children: [],
      options: optNames.map(t => ({ value: t.toLowerCase(), text: t })),
    };
  }

  // Text content: only direct text, not children's text.
  let text: string | undefined;
  const childElements = Array.from(el.children).filter((c) => {
    const ct = c.tagName.toLowerCase();
    return SUPPORTED_TAGS.has(ct) && ct !== "option";
  });

  if (childElements.length === 0) {
    const tc = el.textContent?.trim();
    if (tc) text = tc;
  }

  const node: UIElementNode = { tag: effectiveTag, id, classes, text, value: valueAttr, name: nameAttr, checked: checkedAttr, children: [] };
  for (const child of childElements) {
    node.children.push(domToUIElementNode(child));
  }
  return node;
}
