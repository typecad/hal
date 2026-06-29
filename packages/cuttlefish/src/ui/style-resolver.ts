// ---------------------------------------------------------------------------
// Style resolver — match CSS rules to element nodes and produce a computed
// style per node (base state + :pressed state).
//
// Walks the tree; for each node, applies every matching rule in source order
// (cascade: later rules win). :pressed rules populate the separate
// `style.pressed` object so the runtime can lerp to it on press.
// ---------------------------------------------------------------------------

import { UIElementNode } from "./html-parser.js";
import type { Diagnostic } from "../types.js";
import { CSSRule, CSSProperty, CSSSelector, SimpleSelector, parseInlineStyle } from "./css-parser.js";
import { getUARules } from "./ua-stylesheet.js";

export interface StyledNode {
  tag: string;
  origTag?: string;
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
  /** Canvas buffer width in pixels (for <canvas>). */
  canvasW?: number;
  /** Canvas buffer height in pixels (for <canvas>). */
  canvasH?: number;
  disabled?: boolean;
}

/** Look up an HTML attribute value on a node by name, for attribute selectors.
 *  Returns the value as a string, or undefined when absent. Boolean attributes
 *  (checked/disabled/hidden) are "present" only when truthy. UIElementNode has
 *  no generic attribute map, so each name maps to a typed field. */
function attributeValue(node: UIElementNode, name: string): string | undefined {
  switch (name) {
    case "type": return node.type;
    case "name": return node.name;
    case "value": return node.value;
    case "href": return node.href;
    case "src": return node.src;
    case "placeholder": return node.placeholder;
    case "maxlength": return node.maxlength != null ? String(node.maxlength) : undefined;
    // Boolean attributes: report presence by returning the attribute name.
    case "checked": return node.checked ? "checked" : undefined;
    case "disabled": return node.disabled ? "disabled" : undefined;
    case "hidden": return node.hidden ? "hidden" : undefined;
    default: return undefined;
  }
}

/** Does a single element match a compound selector (all simples must match)? */
function matchesCompound(node: UIElementNode, compound: SimpleSelector[]): boolean {
  for (const s of compound) {
    switch (s.kind) {
      case "element": if (node.tag !== s.name && node.origTag !== s.name) return false; break;
      case "id": if (node.id !== s.name) return false; break;
      case "class": if (!node.classes.includes(s.name)) return false; break;
      case "attribute": {
        // Presence ([disabled]) when no value; exact equality ([type="number"])
        // when a value is present. NOTE: the parser captures [~=|^|$*]= but
        // drops the operator, so only presence/equality are supported here.
        const v = attributeValue(node, s.name);
        if (v === undefined) return false;
        if (s.value !== undefined && v !== s.value) return false;
        break;
      }
    }
  }
  return true;
}

/** Match the ancestor-side compounds (indices 0..c) against the `ancestors`
 *  chain, honoring combinators. `pos` is the exclusive upper bound: compound c
 *  may match any ancestor at index < pos. The node itself sits conceptually at
 *  index ancestors.length, so the first ancestor-side compound starts with the
 *  whole chain available. Returns true if all remaining compounds match. */
function matchAncestors(
  compounds: SimpleSelector[][],
  combinators: (">" | " " | "+" | "~")[],
  c: number,
  pos: number,
  ancestors: UIElementNode[],
  precedingSiblings: UIElementNode[],
): boolean {
  if (c < 0) return true;
  const comb = c < combinators.length ? combinators[c] : " ";
  if (comb === ">") {
    // Child combinator: compound c must match the immediate parent (index
    // pos-1) of wherever compound c+1 matched. No scanning.
    const i = pos - 1;
    if (i < 0) return false;
    if (!matchesCompound(ancestors[i], compounds[c])) return false;
    // Children of the matched ancestor are its siblings-in-context; for a
    // child match there are no further preceding siblings to track here.
    return matchAncestors(compounds, combinators, c - 1, i, ancestors, []);
  }
  if (comb === "+") {
    // Adjacent sibling: compound c must match the IMMEDIATE preceding sibling
    // of compound c+1's match. precedingSiblings[0] is the nearest.
    if (precedingSiblings.length === 0) return false;
    if (!matchesCompound(precedingSiblings[0], compounds[c])) return false;
    // The matched sibling's own preceding siblings (for chains like a + b + c).
    const sibAncestors = ancestors;  // siblings share the same ancestors
    return matchAncestors(compounds, combinators, c - 1, pos, sibAncestors, precedingSiblings.slice(1));
  }
  if (comb === "~") {
    // General sibling: compound c matches ANY preceding sibling. Scan from
    // nearest outward; backtrack if a later compound fails.
    for (let si = 0; si < precedingSiblings.length; si++) {
      if (matchesCompound(precedingSiblings[si], compounds[c])) {
        if (matchAncestors(compounds, combinators, c - 1, pos, ancestors, precedingSiblings.slice(si + 1))) {
          return true;
        }
      }
    }
    return false;
  }
  // Descendant combinator: scan ancestors upward (decreasing index) for a
  // match. Backtracking — if a later compound fails, try an earlier ancestor.
  for (let i = pos - 1; i >= 0; i--) {
    if (matchesCompound(ancestors[i], compounds[c])) {
      if (matchAncestors(compounds, combinators, c - 1, i, ancestors, [])) return true;
    }
  }
  return false;
}

/** Does an element match a full selector (compound + combinators)?
 *  The last compound must match the node; preceding compounds must match
 *  ancestors per the combinators (` ` = descendant, `>` = child). */
function matches(node: UIElementNode, sel: CSSSelector, ancestors: UIElementNode[], precedingSiblings: UIElementNode[]): boolean {
  const compounds = sel.compounds;
  // Target compound (last) must match the node.
  if (!matchesCompound(node, compounds[compounds.length - 1])) return false;
  // :not(...) negation: if ANY inner compound matches the node, reject.
  if (sel.not) {
    for (const inner of sel.not) {
      if (matchesCompound(node, inner)) return false;
    }
  }
  // Match preceding compounds against the ancestor chain, honoring combinators.
  return matchAncestors(compounds, sel.combinators ?? [], compounds.length - 2, ancestors.length, ancestors, precedingSiblings);
}

export function resolveStyles(root: UIElementNode, rules: CSSRule[], diagnostics?: Diagnostic[]): StyledNode {
  const allRules = [...getUARules(), ...rules];
  return resolveNode(root, allRules, [], diagnostics);
}

function resolveNode(node: UIElementNode, rules: CSSRule[], ancestors: UIElementNode[], diagnostics?: Diagnostic[]): StyledNode {
  const base: CSSProperty = {};
  const pressed: CSSProperty = {};

  // Preceding siblings of this node (most-recent-first), for + and ~ combinators.
  // The parent is the last ancestor; its children before this node are siblings.
  const parent = ancestors.length > 0 ? ancestors[ancestors.length - 1] : undefined;
  let precedingSiblings: UIElementNode[] = [];
  if (parent) {
    const idx = parent.children.indexOf(node);
    if (idx > 0) precedingSiblings = parent.children.slice(0, idx).reverse();
  }

  for (const rule of rules) {
    if (!matches(node, rule.selector, ancestors, precedingSiblings)) continue;
    if (rule.selector.pseudo === "pressed") {
      Object.assign(pressed, rule.properties);
    } else {
      Object.assign(base, rule.properties);
    }
  }

  const style: CSSProperty = base;
  // Inline style attribute has the highest priority — merge last.
  if (node.inlineStyle) {
    Object.assign(style, parseInlineStyle(node.inlineStyle, diagnostics));
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
    origTag: node.origTag,
    id: node.id,
    classes: node.classes,
    text: node.text,
    value: node.value,
    style,
    children: node.children.map(c => resolveNode(c, rules, childAncestors, diagnostics)),
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
    canvasW: node.canvasW,
    canvasH: node.canvasH,
    disabled: (node as any).disabled,
  };
}
