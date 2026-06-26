// ---------------------------------------------------------------------------
// Style resolver — match CSS rules to element nodes and produce a computed
// style per node (base state + :pressed state).
//
// Walks the tree; for each node, applies every matching rule in source order
// (cascade: later rules win). :pressed rules populate the separate
// `style.pressed` object so the runtime can lerp to it on press.
// ---------------------------------------------------------------------------

import { UIElementNode } from "./html-parser.js";
import { CSSRule, CSSProperty, CSSSelector, SimpleSelector, parseInlineStyle } from "./css-parser.js";
import { getUARules } from "./ua-stylesheet.js";

export interface StyledNode {
  tag: string;
  id?: string;
  classes: string[];
  text?: string;
  value?: string;
  style: CSSProperty;
  children: StyledNode[];
  /** For <select>: parsed option list. */
  options?: Array<{ value: string; text: string }>;
  /** For <radio>: group name. */
  name?: string;
  /** For <radio>: initially selected. */
  checked?: boolean;
  /** For <range>: minimum value. */
  min?: string;
  /** For <range>: maximum value. */
  max?: string;
  /** For <input>: text or number keyboard. */
  type?: "text" | "number";
  /** For <input>: placeholder text. */
  placeholder?: string;
  /** For <input>: max character length. */
  maxlen?: number;
  /** For <input>: keyboard template id ref. */
  keyboard?: string;
  /** HTML hidden attribute: removes the element subtree from layout/rendering. */
  hidden?: boolean;
  /** Navigation target for <a href="#screenId"> links. */
  href?: string;
  /** Image source path for <img src="...">. */
  src?: string;
  /** Image width in pixels (for <img>). */
  imgWidth?: number;
  /** Image height in pixels (for <img>). */
  imgHeight?: number;
  /** Item height in pixels (for <list>). */
  itemHeight?: number;
}

/** Does a single element match a compound selector (all simples must match)? */
function matchesCompound(node: UIElementNode, compound: SimpleSelector[]): boolean {
  for (const s of compound) {
    switch (s.kind) {
      case "element": if (node.tag !== s.name) return false; break;
      case "id": if (node.id !== s.name) return false; break;
      case "class": if (!node.classes.includes(s.name)) return false; break;
    }
  }
  return true;
}

/** Does an element match a full selector (compound + descendant)?
 *  The last compound must match the node; preceding compounds must match
 *  some ancestor in the chain (passed as `ancestors`). */
function matches(node: UIElementNode, sel: CSSSelector, ancestors: UIElementNode[]): boolean {
  const compounds = sel.compounds;
  // Target compound (last) must match the node.
  if (!matchesCompound(node, compounds[compounds.length - 1])) return false;
  // Ancestor compounds must match in order, walking up the chain.
  let ancIdx = ancestors.length - 1;
  for (let c = compounds.length - 2; c >= 0; c--) {
    let found = false;
    while (ancIdx >= 0) {
      if (matchesCompound(ancestors[ancIdx], compounds[c])) {
        found = true;
        ancIdx--;
        break;
      }
      ancIdx--;
    }
    if (!found) return false;
  }
  return true;
}

export function resolveStyles(root: UIElementNode, rules: CSSRule[]): StyledNode {
  const allRules = [...getUARules(), ...rules];
  return resolveNode(root, allRules, []);
}

function resolveNode(node: UIElementNode, rules: CSSRule[], ancestors: UIElementNode[]): StyledNode {
  const base: CSSProperty = {};
  const pressed: CSSProperty = {};

  for (const rule of rules) {
    if (!matches(node, rule.selector, ancestors)) continue;
    if (rule.selector.pseudo === "pressed") {
      Object.assign(pressed, rule.properties);
    } else {
      Object.assign(base, rule.properties);
    }
  }

  const style: CSSProperty = base;
  // Inline style attribute has the highest priority — merge last.
  if (node.inlineStyle) {
    Object.assign(style, parseInlineStyle(node.inlineStyle));
  }
  if (node.hidden) {
    style.display = "none";
  }
  if (Object.keys(pressed).length > 0) {
    // Attach pressed overrides; the transition driver reads these on press.
    (style as CSSProperty & { pressed?: CSSProperty }).pressed = pressed;
  }

  const childAncestors = [...ancestors, node];
  return {
    tag: node.tag,
    id: node.id,
    classes: node.classes,
    text: node.text,
    value: node.value,
    style,
    children: node.children.map(c => resolveNode(c, rules, childAncestors)),
    options: node.options,
    name: node.name,
    checked: node.checked,
    min: node.min,
    max: node.max,
    type: node.type,
    placeholder: node.placeholder,
    maxlen: node.maxlength,
    keyboard: node.keyboard,
    hidden: node.hidden,
    href: node.href,
    src: node.src,
    imgWidth: node.imgWidth,
    imgHeight: node.imgHeight,
    itemHeight: node.itemHeight,
  };
}
