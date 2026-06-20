// ---------------------------------------------------------------------------
// CSS subset parser — a tiny, dependency-free parser for .ui.css files.
//
// Supported subset:
//   - Selectors: element, #id, .class, optionally with :pressed pseudo.
//   - Properties: padding, margin, width, height, color, background, font,
//     font-size, transition.
// ---------------------------------------------------------------------------

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
  padding?: number;
  margin?: number;
  width?: number;
  height?: number;
  color?: string;
  background?: string;
  font?: string;        // e.g. "8x16"
  fontSize?: number;
  transition?: TransitionDecl;
}

export interface CSSRule {
  selector: CSSSelector;
  properties: CSSProperty;
}

const SUPPORTED_PROPS = new Set([
  "padding", "margin", "width", "height", "color", "background",
  "font", "font-size", "transition",
]);

export function parseCss(src: string): CSSRule[] {
  const rules: CSSRule[] = [];
  // Match selector { ... } blocks.
  const blockRe = /([^{}]+)\{([^{}]*)\}/g;
  let m: RegExpExecArray | null;
  while ((m = blockRe.exec(src)) !== null) {
    const selectorStr = m[1].trim();
    const bodyStr = m[2].trim();
    const selector = parseSelector(selectorStr);
    const properties = parseBody(bodyStr);
    rules.push({ selector, properties });
  }
  return rules;
}

function parseSelector(s: string): CSSSelector {
  const pseudoM = /:pressed$/.exec(s);
  const base = pseudoM ? s.slice(0, pseudoM.index) : s;
  const trimmed = base.trim();
  let kind: CSSSelectorKind;
  let name: string;
  if (trimmed.startsWith("#")) { kind = "id"; name = trimmed.slice(1); }
  else if (trimmed.startsWith(".")) { kind = "class"; name = trimmed.slice(1); }
  else { kind = "element"; name = trimmed; }
  return { kind, name, pseudo: pseudoM ? "pressed" : undefined };
}

function parseBody(body: string): CSSProperty {
  const props: CSSProperty = {};
  for (const decl of body.split(";").map(d => d.trim()).filter(Boolean)) {
    const colonIdx = decl.indexOf(":");
    if (colonIdx < 0) continue;
    const prop = decl.slice(0, colonIdx).trim();
    const val = decl.slice(colonIdx + 1).trim();
    if (!SUPPORTED_PROPS.has(prop)) {
      throw new Error(`Unsupported CSS property "${prop}" — supported: ${[...SUPPORTED_PROPS].join(", ")}`);
    }
    assignProp(props, prop, val);
  }
  return props;
}

function assignProp(props: CSSProperty, prop: string, val: string): void {
  switch (prop) {
    case "padding": props.padding = num(val); break;
    case "margin": props.margin = num(val); break;
    case "width": props.width = num(val); break;
    case "height": props.height = num(val); break;
    case "color": props.color = val; break;
    case "background": props.background = val; break;
    case "font": props.font = val; break;
    case "font-size": props.fontSize = num(val); break;
    case "transition": props.transition = parseTransition(val); break;
  }
}

function num(val: string): number {
  // Strip units we recognize (px, ms handled separately for transitions).
  const digits = val.replace(/px$/, "").trim();
  const n = Number(digits);
  if (isNaN(n)) throw new Error(`Invalid numeric value "${val}"`);
  return n;
}

function parseTransition(val: string): TransitionDecl {
  const parts = val.split(/\s+/);
  if (parts.length !== 2) throw new Error(`transition expects "<property> <duration>" — got "${val}"`);
  const property = parts[0];
  if (property !== "background" && property !== "color") {
    throw new Error(`transition supports only background/color — got "${property}"`);
  }
  const durStr = parts[1].replace(/ms$/, "").trim();
  const durationMs = Number(durStr);
  if (isNaN(durationMs)) throw new Error(`Invalid transition duration "${parts[1]}"`);
  return { property: property as "background" | "color", durationMs };
}
