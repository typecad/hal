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
  children: UIElementNode[];
}

const SUPPORTED_TAGS = new Set(["screen", "text", "button", "view", "check"]);

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

  if (!SUPPORTED_TAGS.has(tag)) {
    throw new Error(`Unsupported tag <${tag}> — supported: ${[...SUPPORTED_TAGS].join(", ")}`);
  }

  const id = el.getAttribute("id") || undefined;
  const classAttr = el.getAttribute("class") || "";
  const classes = classAttr.split(/\s+/).filter(Boolean);

  // Text content: only direct text, not children's text.
  // For leaf elements (text/button), the textContent IS the text.
  // For containers (screen/view), direct text is ignored.
  let text: string | undefined;
  const childElements = Array.from(el.children).filter((c) =>
    SUPPORTED_TAGS.has(c.tagName.toLowerCase()),
  );

  if (childElements.length === 0) {
    const tc = el.textContent?.trim();
    if (tc) text = tc;
  }

  const node: UIElementNode = { tag, id, classes, text, children: [] };
  for (const child of childElements) {
    node.children.push(domToUIElementNode(child));
  }
  return node;
}
