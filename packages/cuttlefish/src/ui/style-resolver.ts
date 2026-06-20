// ---------------------------------------------------------------------------
// Style resolver — match CSS rules to element nodes and produce a computed
// style per node (base state + :pressed state).
//
// Walks the tree; for each node, applies every matching rule in source order
// (cascade: later rules win). :pressed rules populate the separate
// `style.pressed` object so the runtime can lerp to it on press.
// ---------------------------------------------------------------------------

import { UIElementNode } from "./html-parser";
import { CSSRule, CSSProperty, CSSSelector } from "./css-parser";

export interface StyledNode {
  tag: string;
  id?: string;
  classes: string[];
  text?: string;
  style: CSSProperty;
  children: StyledNode[];
}

function matches(node: UIElementNode, sel: CSSSelector): boolean {
  switch (sel.kind) {
    case "element": return node.tag === sel.name;
    case "id": return node.id === sel.name;
    case "class": return node.classes.includes(sel.name);
  }
}

export function resolveStyles(root: UIElementNode, rules: CSSRule[]): StyledNode {
  return resolveNode(root, rules);
}

function resolveNode(node: UIElementNode, rules: CSSRule[]): StyledNode {
  const base: CSSProperty = {};
  const pressed: CSSProperty = {};

  for (const rule of rules) {
    if (!matches(node, rule.selector)) continue;
    if (rule.selector.pseudo === "pressed") {
      Object.assign(pressed, rule.properties);
    } else {
      Object.assign(base, rule.properties);
    }
  }

  const style: CSSProperty = base;
  if (Object.keys(pressed).length > 0) {
    // Attach pressed overrides; the transition driver reads these on press.
    (style as CSSProperty & { pressed?: CSSProperty }).pressed = pressed;
  }

  return {
    tag: node.tag,
    id: node.id,
    classes: node.classes,
    text: node.text,
    style,
    children: node.children.map(c => resolveNode(c, rules)),
  };
}
