// ---------------------------------------------------------------------------
// CSS parser — uses css-tree for robust, standards-compliant parsing.
//
// Parses .ui.css into CSSRule[] (the same shape the hand-rolled parser
// produced), but now supports the full CSS property set that Yoga needs:
// display, flex-direction, gap, align-self, border, border-radius, etc.
//
// Unknown properties are silently dropped (forward-compatible) rather than
// throwing — the hand-rolled parser's throw-on-unknown blocked flexbox.
// ---------------------------------------------------------------------------

import { parse, walk, generate } from "css-tree";

export type CSSSelectorKind = "element" | "id" | "class";

export interface CSSSelector {
  kind: CSSSelectorKind;
  name: string;
  pseudo?: "pressed";
}

export interface TransitionDecl {
  property: "background" | "color";
  durationMs: number;
}

export interface CSSProperty {
  // Box model
  padding?: string;
  margin?: string;
  width?: string;
  height?: string;
  minWidth?: string;
  maxWidth?: string;
  minHeight?: string;
  maxHeight?: string;
  boxSizing?: string;
  overflow?: string;
  // Colors
  color?: string;
  background?: string;
  // Text
  font?: string;
  fontSize?: string;
  textAlign?: string;       // left | center | right
  textDecoration?: string;  // underline | none
  fontWeight?: string;      // normal | bold
  lineHeight?: string;
  letterSpacing?: string;
  whiteSpace?: string;      // nowrap | normal
  textTransform?: string;   // uppercase | lowercase | capitalize | none
  // Animation
  transition?: TransitionDecl;
  // Flexbox / layout (Yoga)
  display?: string;
  flexDirection?: string;
  gap?: string;
  flexGrow?: string;
  flexShrink?: string;
  flexBasis?: string;
  alignSelf?: string;
  alignItems?: string;
  justifyContent?: string;
  flexWrap?: string;
  order?: string;
  position?: string;        // relative | absolute | static
  top?: string;
  right?: string;
  bottom?: string;
  left?: string;
  // Visual
  border?: string;
  borderRadius?: string;
  borderWidth?: string;
  borderColor?: string;
  borderStyle?: string;     // solid | dashed | dotted | none
  opacity?: string;
  visibility?: string;      // visible | hidden
  outline?: string;
  boxShadow?: string;
}

export interface CSSRule {
  selector: CSSSelector;
  properties: CSSProperty;
}

export function parseCss(src: string): CSSRule[] {
  // Strip CSS comments before parsing (they may contain { or }).
  const withoutComments = src.replace(/\/\*[\s\S]*?\*\//g, "");
  const rules: CSSRule[] = [];

  let ast;
  try {
    ast = parse(withoutComments, { parseCustomProperty: true });
  } catch {
    // css-tree may fail on edge-case CSS; fall back to empty rules.
    return rules;
  }

  walk(ast, {
    enter(node: any) {
      if (node.type !== "Rule") return;

      // Extract selector text via generate (robust across css-tree versions).
      const selectorText = generate(node.prelude).trim();
      const selector = parseSelector(selectorText);
      if (!selector) return;

      // Extract declarations.
      const props: CSSProperty = {};
      node.block.children.forEach((child: any) => {
        if (child.type !== "Declaration") return;
        const prop = child.property;
        const val = generate(child.value).trim();
        assignProp(props, prop, val);
      });

      rules.push({ selector, properties: props });
    },
  });

  return rules;
}

/** Parse a single selector string into a CSSSelector (element/#id/.class + :pressed). */
function parseSelector(s: string): CSSSelector | null {
  // Handle :pressed pseudo-state (may also appear as :active for browser compat).
  const pseudoM = /:(pressed|active)$/.exec(s);
  const base = pseudoM ? s.slice(0, pseudoM.index) : s;
  const trimmed = base.trim().replace(/^["']|["']$/g, "");

  let kind: CSSSelectorKind;
  let name: string;
  if (trimmed.startsWith("#")) { kind = "id"; name = trimmed.slice(1); }
  else if (trimmed.startsWith(".")) { kind = "class"; name = trimmed.slice(1); }
  else { kind = "element"; name = trimmed; }

  if (!name) return null;
  return { kind, name, pseudo: pseudoM ? "pressed" : undefined };
}

/** Parse a numeric value from a CSS string like "8px" or "8" → 8. */
function num(val: string): number {
  const digits = val.replace(/px$|rem$|em$|%$/g, "").trim();
  const n = Number(digits);
  return isNaN(n) ? 0 : n;
}

/** Parse a transition value: "background 80ms" → { property, durationMs }. */
function parseTransition(val: string): TransitionDecl {
  const parts = val.split(/\s+/);
  if (parts.length < 2) return { property: "background", durationMs: 0 };
  const property = parts[0];
  if (property !== "background" && property !== "color") {
    return { property: "background", durationMs: 0 };
  }
  const durStr = parts[1].replace(/ms$|s$/g, "").trim();
  let durationMs = Number(durStr);
  if (parts[1].endsWith("s") && !parts[1].endsWith("ms")) durationMs *= 1000;
  if (isNaN(durationMs)) durationMs = 0;
  return { property: property as "background" | "color", durationMs };
}

/** Assign a CSS property to the CSSProperty object. Unknown properties are silently dropped. */
function assignProp(props: CSSProperty, prop: string, val: string): void {
  switch (prop) {
    // Box model
    case "padding": props.padding = val; break;
    case "margin": props.margin = val; break;
    case "width": props.width = val; break;
    case "height": props.height = val; break;
    case "min-width": props.minWidth = val; break;
    case "max-width": props.maxWidth = val; break;
    case "min-height": props.minHeight = val; break;
    case "max-height": props.maxHeight = val; break;
    case "box-sizing": props.boxSizing = val; break;
    case "overflow": props.overflow = val; break;
    // Colors
    case "color": props.color = val; break;
    case "background":
    case "background-color": props.background = val; break;
    // Text
    case "font": props.font = val; break;
    case "font-size": props.fontSize = val; break;
    case "text-align": props.textAlign = val; break;
    case "text-decoration": props.textDecoration = val; break;
    case "font-weight": props.fontWeight = val; break;
    case "line-height": props.lineHeight = val; break;
    case "letter-spacing": props.letterSpacing = val; break;
    case "white-space": props.whiteSpace = val; break;
    case "text-transform": props.textTransform = val; break;
    // Animation
    case "transition": props.transition = parseTransition(val); break;
    // Flexbox / layout
    case "display": props.display = val; break;
    case "flex-direction": props.flexDirection = val; break;
    case "gap":
    case "row-gap":
    case "column-gap": props.gap = val; break;
    case "flex": parseFlexShorthand(props, val); break;
    case "flex-grow": props.flexGrow = val; break;
    case "flex-shrink": props.flexShrink = val; break;
    case "flex-basis": props.flexBasis = val; break;
    case "align-self": props.alignSelf = val; break;
    case "align-items": props.alignItems = val; break;
    case "justify-content": props.justifyContent = val; break;
    case "flex-wrap": props.flexWrap = val; break;
    case "order": props.order = val; break;
    case "position": props.position = val; break;
    case "top": props.top = val; break;
    case "right": props.right = val; break;
    case "bottom": props.bottom = val; break;
    case "left": props.left = val; break;
    // Visual
    case "border": props.border = val; parseBorderShorthand(props, val); break;
    case "border-radius": props.borderRadius = val; break;
    case "border-width": props.borderWidth = val; break;
    case "border-color": props.borderColor = val; break;
    case "border-style": props.borderStyle = val; break;
    case "opacity": props.opacity = val; break;
    case "visibility": props.visibility = val; break;
    case "outline": props.outline = val; break;
    case "box-shadow": props.boxShadow = val; break;
    // Unknown properties are silently dropped (forward-compatible).
  }
}

/** Parse the `flex` shorthand: "1" → grow=1,shrink=1,basis=0%.
 *  "1 0 auto" → grow=1, shrink=0, basis=auto. */
function parseFlexShorthand(props: CSSProperty, val: string): void {
  const parts = val.trim().split(/\s+/);
  if (parts.length === 1) {
    // Single value: either a number (grow) or a dimension (basis) or "none"
    if (parts[0] === "none") {
      props.flexGrow = "0"; props.flexShrink = "0"; props.flexBasis = "auto";
    } else if (/^\d+(\.\d+)?$/.test(parts[0])) {
      props.flexGrow = parts[0]; props.flexShrink = "1"; props.flexBasis = "0%";
    } else {
      props.flexBasis = parts[0];
    }
  } else if (parts.length >= 2) {
    props.flexGrow = parts[0];
    props.flexShrink = parts[1];
    if (parts[2]) props.flexBasis = parts[2];
  }
}

/** Parse the `border` shorthand: "2px solid #808080" → width, style, color. */
function parseBorderShorthand(props: CSSProperty, val: string): void {
  const parts = val.trim().split(/\s+/);
  for (const p of parts) {
    if (/^\d+px$/.test(p)) props.borderWidth = p;
    else if (["solid", "dashed", "dotted", "double", "none"].includes(p)) props.borderStyle = p;
    else if (p.startsWith("#") || p.startsWith("rgb") || /^[a-z]+$/i.test(p)) props.borderColor = p;
  }
}
