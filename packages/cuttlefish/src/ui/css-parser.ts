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

/** A single simple selector: tag name, #id, or .class. */
export interface SimpleSelector {
  kind: CSSSelectorKind;
  name: string;
}

/** A full CSS selector, supporting compound (`.foo.bar`, `tag.class`) and
 *  descendant (`parent child`) combinators.
 *  - `compounds[last]` is the target compound (the element the rule applies to).
 *  - Each compound is an array of simples that must ALL match (AND).
 *  - Preceding compounds are ancestor constraints (descendant combinator). */
export interface CSSSelector {
  compounds: SimpleSelector[][];
  pseudo?: "pressed";
}

export interface TransitionDecl {
  property: "background" | "color";
  durationMs: number;
}

export interface KeyframeStop {
  percent: number;   // 0-100
  background?: string;
  color?: string;
  opacity?: string;
  transform?: string;
  transformOrigin?: string;
  left?: string;
  top?: string;
  width?: string;
  height?: string;
}

export interface KeyframeSet {
  name: string;
  stops: KeyframeStop[];
}

export interface AnimationDecl {
  name: string;
  durationMs: number;
  iterations: number;  // -1 = infinite
  delayMs: number;
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
  aspectRatio?: string;
  boxSizing?: string;
  overflow?: string;
  // Colors
  color?: string;
  background?: string;
  // Text
  font?: string;
  fontFamily?: string;
  fontSize?: string;
  textAlign?: string;       // left | center | right
  textDecoration?: string;  // underline | none
  fontWeight?: string;      // normal | bold
  fontStyle?: string;       // normal | italic | oblique
  fontSmoothing?: string;   // antialiased | none
  fontSubset?: string;      // exact | fallback/auto
  lineHeight?: string;
  letterSpacing?: string;
  whiteSpace?: string;      // nowrap | normal
  textTransform?: string;   // uppercase | lowercase | capitalize | none
  // Animation
  transition?: TransitionDecl;
  animation?: string;  // shorthand: "pulse 2s infinite"
  animationName?: string;
  animationDuration?: string;
  animationIterationCount?: string;
  animationDelay?: string;
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
  zIndex?: string;
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
  textShadow?: string;
  transform?: string;
  transformOrigin?: string;
  objectFit?: string;  // fill | contain | cover | scale-down | none
}

export interface CSSRule {
  selector: CSSSelector;
  properties: CSSProperty;
}

export interface CSSFontFace {
  fontFamily: string;
  src: string;
  fontWeight?: string;
  fontStyle?: string;
}

export function parseCss(src: string): CSSRule[] {
  // Strip CSS comments before parsing (they may contain { or }).
  const withoutComments = stripKeyframes(src.replace(/\/\*[\s\S]*?\*\//g, ""));
  const rules: CSSRule[] = [];
  // CSS custom properties (--name: value), extracted from :root-like rules.
  const variables: Record<string, string> = {};

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

      // Capture CSS custom properties from :root declarations.
      if (selectorText === ":root") {
        node.block.children.forEach((child: any) => {
          if (child.type === "Declaration" && child.property.startsWith("--")) {
            variables[child.property] = generate(child.value).trim();
          }
        });
        return; // :root is not a styling rule
      }

      const selector = parseSelector(selectorText);
      if (!selector) return;

      // Extract declarations.
      const props: CSSProperty = {};
      node.block.children.forEach((child: any) => {
        if (child.type !== "Declaration") return;
        // Strip vendor prefixes (-webkit-, -moz-, -ms-, -o-) so authors can
        // paste cross-browser CSS without manual cleanup.
        const prop = child.property.replace(/^-(?:webkit|moz|ms|o)-/, "");
        const val = generate(child.value).trim();
        assignProp(props, prop, val);
      });

      // css-tree emits comma-separated selectors as one string ("a, b").
      // Split on commas to produce one CSSRule per selector.
      const selectorParts = selectorText.split(",").map(s => s.trim()).filter(Boolean);
      for (const part of selectorParts) {
        const sel = parseSelector(part);
        if (sel) rules.push({ selector: sel, properties: props });
      }
    },
  });

  // Substitute var(--name) references in all property values.
  if (Object.keys(variables).length > 0) {
    for (const rule of rules) {
      substituteVars(rule.properties, variables);
    }
  }

  return rules;
}

export function parseFontFaces(src: string): CSSFontFace[] {
  const withoutComments = src.replace(/\/\*[\s\S]*?\*\//g, "");
  const faces: CSSFontFace[] = [];

  let ast;
  try {
    ast = parse(withoutComments, { parseCustomProperty: true });
  } catch {
    return faces;
  }

  walk(ast, {
    enter(node: any) {
      if (node.type !== "Atrule" || node.name !== "font-face" || !node.block) return;
      const decls: Record<string, string> = {};
      node.block.children.forEach((child: any) => {
        if (child.type !== "Declaration") return;
        decls[child.property] = generate(child.value).trim();
      });
      const fontFamily = decls["font-family"] ? unquoteCss(decls["font-family"]) : "";
      const src = extractFontSrc(decls.src ?? "");
      if (!fontFamily || !src) return;
      faces.push({
        fontFamily,
        src,
        fontWeight: decls["font-weight"],
        fontStyle: decls["font-style"],
      });
    },
  });

  return faces;
}

/** Replace var(--name) in all string-valued CSS properties. */
function substituteVars(props: CSSProperty, variables: Record<string, string>): void {
  for (const key of Object.keys(props) as (keyof CSSProperty)[]) {
    const val = props[key];
    if (typeof val === "string" && val.includes("var(")) {
      (props[key] as string) = val.replace(/var\(\s*(--[\w-]+)\s*\)/g, (_, name) => variables[name] ?? "");
    } else if (val && typeof val === "object" && "property" in val) {
      // TransitionDecl — no var() in its fields, skip
    }
  }
}

function unquoteCss(value: string): string {
  const trimmed = value.trim();
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function extractFontSrc(value: string): string {
  const url = /url\(\s*(['"]?)(.*?)\1\s*\)/.exec(value);
  if (url?.[2]) return url[2].trim();
  return unquoteCss(value.split(",")[0] ?? "");
}

/** Parse an inline style string ("color: red; font-size: 16px") into CSSProperty.
 *  Uses the same assignProp pipeline as rule parsing. */
export function parseInlineStyle(src: string): CSSProperty {
  const props: CSSProperty = {};
  for (const decl of src.split(";")) {
    const colonIdx = decl.indexOf(":");
    if (colonIdx < 0) continue;
    const prop = decl.slice(0, colonIdx).trim();
    const val = decl.slice(colonIdx + 1).trim();
    if (prop && val) assignProp(props, prop, val);
  }
  return props;
}

/** Parse a selector string into compounds + simples.
 *  Supports: `.foo`, `#bar`, `tag`, `.foo.bar` (compound), `tag.cls` is not valid
 *  CSS (no dot in tag names), `parent child` (descendant), and `:pressed`.
 *  Returns null for empty/invalid selectors. */
function parseSelector(s: string): CSSSelector | null {
  // Strip :pressed / :active pseudo (may appear after the last compound).
  const pseudoM = /:(pressed|active)$/.exec(s);
  const base = pseudoM ? s.slice(0, pseudoM.index) : s;
  const trimmed = base.trim().replace(/^["']|["']$/g, "");
  if (!trimmed) return null;

  // Split on whitespace into compound groups (descendant combinator).
  const groups = trimmed.split(/\s+/).filter(Boolean);
  const compounds: SimpleSelector[][] = [];
  for (const group of groups) {
    // Split a compound into simples: .class, #id, or bare tag.
    // Use a regex that captures leading . or # prefixed tokens.
    const simples: SimpleSelector[] = [];
    const tokenRe = /([.#]?)([a-zA-Z_][\w-]*)/g;
    let m: RegExpExecArray | null;
    while ((m = tokenRe.exec(group)) !== null) {
      const prefix = m[1];
      const name = m[2];
      if (prefix === "#") simples.push({ kind: "id", name });
      else if (prefix === ".") simples.push({ kind: "class", name });
      else simples.push({ kind: "element", name });
    }
    if (simples.length > 0) compounds.push(simples);
  }
  if (compounds.length === 0) return null;
  return { compounds, pseudo: pseudoM ? "pressed" : undefined };
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

/** Parse the animation shorthand: "pulse 2s infinite 500ms".
 *  Fields: name (identifier), duration (Nms/Ns), iterations (number|infinite), delay (Nms/Ns). */
export function parseAnimation(val: string): AnimationDecl | null {
  const first = val.split(",")[0]?.trim() ?? "";
  const parts = first.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return null;
  const decl: AnimationDecl = { name: "", durationMs: 1000, iterations: 1, delayMs: 0 };
  let foundDuration = false;
  for (const part of parts) {
    const lower = part.toLowerCase();
    if (lower === "none") {
      return null;
    } else if (lower === "infinite") {
      decl.iterations = -1;
    } else if (/^\d+(?:\.\d+)?ms$/.test(lower)) {
      const ms = Math.round(parseFloat(lower));
      if (!foundDuration) { decl.durationMs = ms; foundDuration = true; }
      else decl.delayMs = ms;
    } else if (/^\d+(?:\.\d+)?s$/.test(lower)) {
      const ms = Math.round(parseFloat(lower) * 1000);
      if (!foundDuration) { decl.durationMs = ms; foundDuration = true; }
      else decl.delayMs = ms;
    } else if (/^\d+$/.test(lower)) {
      decl.iterations = parseInt(lower, 10);
    } else if (
      lower === "linear" ||
      lower === "ease" ||
      lower === "ease-in" ||
      lower === "ease-out" ||
      lower === "ease-in-out" ||
      lower === "normal" ||
      lower === "reverse" ||
      lower === "alternate" ||
      lower === "alternate-reverse" ||
      lower === "forwards" ||
      lower === "backwards" ||
      lower === "both" ||
      lower === "running" ||
      lower === "paused"
    ) {
      continue;
    } else {
      // Identifier: the first non-keyword token is the animation name.
      decl.name = part;
    }
  }
  if (!decl.name) return null;
  return decl;
}

/** Parse @keyframes blocks from CSS source.
 *  Returns KeyframeSet[] — one per @keyframes name. */
export function parseKeyframes(src: string): KeyframeSet[] {
  const withoutComments = src.replace(/\/\*[\s\S]*?\*\//g, "");
  const sets: KeyframeSet[] = [];

  let ast;
  try {
    ast = parse(withoutComments, { parseCustomProperty: true });
  } catch {
    return sets;
  }

  const variables = extractVariables(withoutComments);

  walk(ast, {
    enter(node: any) {
      if (node.type !== "Atrule" || node.name !== "keyframes" || !node.block) return;
      const name = node.prelude ? generate(node.prelude).trim() : "";
      if (!name) return;

      const merged = new Map<number, KeyframeStop>();
      node.block.children.forEach((rule: any) => {
        if (rule.type !== "Rule" || !rule.block) return;
        const percents = keyframePercents(rule.prelude ? generate(rule.prelude) : "");
        if (percents.length === 0) return;

        const props: Omit<KeyframeStop, "percent"> = {};
        rule.block.children.forEach((decl: any) => {
          if (decl.type !== "Declaration") return;
          const prop = decl.property.replace(/^-(?:webkit|moz|ms|o)-/, "");
          const val = substituteVarsInValue(generate(decl.value).trim(), variables);
          if (prop === "background" || prop === "background-color") props.background = val;
          else if (prop === "color") props.color = val;
          else if (prop === "opacity") props.opacity = val;
          else if (prop === "transform") props.transform = val;
          else if (prop === "transform-origin") props.transformOrigin = val;
          else if (prop === "left") props.left = val;
          else if (prop === "top") props.top = val;
          else if (prop === "width") props.width = val;
          else if (prop === "height") props.height = val;
        });

        for (const percent of percents) {
          const existing = merged.get(percent) ?? { percent };
          merged.set(percent, { ...existing, ...props, percent });
        }
      });

      const stops = [...merged.values()].sort((a, b) => a.percent - b.percent);
      if (stops.length > 0) sets.push({ name, stops });
    },
  });

  return sets;
}

function keyframePercents(selectorText: string): number[] {
  return selectorText
    .split(",")
    .map((part) => {
      const trimmed = part.trim().toLowerCase();
      if (trimmed === "from") return 0;
      if (trimmed === "to") return 100;
      const match = /^(\d+(?:\.\d+)?)%$/.exec(trimmed);
      if (!match) return undefined;
      const value = Math.round(Number(match[1]));
      return value >= 0 && value <= 100 ? value : undefined;
    })
    .filter((value): value is number => value !== undefined);
}

function extractVariables(src: string): Record<string, string> {
  const variables: Record<string, string> = {};
  let ast;
  try {
    ast = parse(src, { parseCustomProperty: true });
  } catch {
    return variables;
  }

  walk(ast, {
    enter(node: any) {
      if (node.type !== "Rule") return;
      const selectorText = generate(node.prelude).trim();
      if (selectorText !== ":root") return;
      node.block.children.forEach((child: any) => {
        if (child.type === "Declaration" && child.property.startsWith("--")) {
          variables[child.property] = generate(child.value).trim();
        }
      });
    },
  });

  return variables;
}

function substituteVarsInValue(value: string, variables: Record<string, string>): string {
  return value.includes("var(")
    ? value.replace(/var\(\s*(--[\w-]+)\s*\)/g, (_, name) => variables[name] ?? "")
    : value;
}

function stripKeyframes(src: string): string {
  let out = "";
  let i = 0;
  while (i < src.length) {
    const match = /@keyframes\s+[\w-]+\s*\{/iy;
    match.lastIndex = i;
    const found = match.exec(src);
    if (!found) {
      out += src[i++];
      continue;
    }

    out += src.slice(i, found.index);
    let depth = 1;
    let j = match.lastIndex;
    while (j < src.length && depth > 0) {
      if (src[j] === "{") depth++;
      else if (src[j] === "}") depth--;
      j++;
    }
    i = j;
  }
  return out;
}
function parseFontShorthand(props: CSSProperty, val: string): void {
  const parts = val.trim().split(/\s+/);
  const sizeIndex = parts.findIndex((part) => /^\d+(?:\.\d+)?(?:px|pt|em|rem)?(?:\/.+)?$/.test(part));
  if (sizeIndex < 0) return;
  const beforeSize = parts.slice(0, sizeIndex);
  const size = parts[sizeIndex].split("/")[0];
  const family = parts.slice(sizeIndex + 1).join(" ").trim();
  if (size) props.fontSize = size;
  if (family) props.fontFamily = family;
  for (const part of beforeSize) {
    const lower = part.toLowerCase();
    if (lower === "italic" || lower === "oblique" || lower === "normal") props.fontStyle = lower;
    else if (lower === "bold" || lower === "bolder" || lower === "lighter" || /^\d{3}$/.test(lower)) props.fontWeight = lower;
  }
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
    case "aspect-ratio": props.aspectRatio = val; break;
    case "box-sizing": props.boxSizing = val; break;
    case "overflow": props.overflow = val; break;
    // Colors
    case "color": props.color = val; break;
    case "background":
    case "background-color": props.background = val; break;
    // Text
    case "font": props.font = val; parseFontShorthand(props, val); break;
    case "font-family": props.fontFamily = val; break;
    case "font-size": props.fontSize = val; break;
    case "text-align": props.textAlign = val; break;
    case "text-decoration": props.textDecoration = val; break;
    case "font-weight": props.fontWeight = val; break;
    case "font-style": props.fontStyle = val; break;
    case "font-smoothing":
    case "font-smooth":
    case "-webkit-font-smoothing": props.fontSmoothing = val; break;
    case "font-subset": props.fontSubset = val; break;
    case "line-height": props.lineHeight = val; break;
    case "letter-spacing": props.letterSpacing = val; break;
    case "white-space": props.whiteSpace = val; break;
    case "text-transform": props.textTransform = val; break;
    // Animation
    case "transition": props.transition = parseTransition(val); break;
    case "animation": props.animation = val; break;
    case "animation-name": props.animationName = val; break;
    case "animation-duration": props.animationDuration = val; break;
    case "animation-iteration-count": props.animationIterationCount = val; break;
    case "animation-delay": props.animationDelay = val; break;
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
    case "z-index": props.zIndex = val; break;
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
    case "border-left": case "border-top": case "border-right": case "border-bottom":
      // Per-side border shorthand — expand into the global fields.
      // For v1, side-specific borders apply to all sides (the runtime draws
      // a uniform border). A future improvement could draw per-side borders.
      props.border = val; parseBorderShorthand(props, val); break;
    case "opacity": props.opacity = val; break;
    case "visibility": props.visibility = val; break;
    case "outline": props.outline = val; break;
    case "box-shadow": props.boxShadow = val; break;
    case "text-shadow": props.textShadow = val; break;
    case "transform": props.transform = val; break;
    case "transform-origin": props.transformOrigin = val; break;
    case "object-fit": props.objectFit = val; break;
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
