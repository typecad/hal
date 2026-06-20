// ---------------------------------------------------------------------------
// HTML subset parser — a tiny, dependency-free parser for .ui.html files.
//
// Supported subset:
//   - One <screen> root (required, exactly one).
//   - Child elements: <text>, <button>, <view> (a generic container).
//   - Attributes: id="...", class="a b".
//   - Text content of leaf elements.
//
// No CDATA, no comments, no self-closing beyond explicit <x/>. This is the
// full v1 surface — extend deliberately.
// ---------------------------------------------------------------------------

export interface UIElementNode {
  tag: string;
  id?: string;
  classes: string[];
  text?: string;
  children: UIElementNode[];
}

const SUPPORTED_TAGS = new Set(["screen", "text", "button", "view"]);

export function parseHtml(src: string): UIElementNode {
  // Strip HTML comments before tokenizing. Comments may contain '>' which
  // would break the tag regex, and they carry no layout meaning.
  const withoutComments = src.replace(/<!--[\s\S]*?-->/g, "");
  const tokens = tokenize(withoutComments);
  const root = parseElement(tokens);
  if (!root || root.tag !== "screen") {
    throw new Error("UI HTML must have exactly one <screen> root element");
  }
  // Ensure no trailing top-level elements.
  if (tokens.peek() !== null) {
    throw new Error("UI HTML must have exactly one top-level <screen> element");
  }
  return root;
}

interface TokenStream {
  pos: number;
  tokens: string[];
  peek(): string | null;
  next(): string | null;
}

function tokenize(src: string): TokenStream {
  // Split into tag tokens and text tokens. Whitespace-only text between tags
  // is ignored; meaningful text (inside leaf elements) is preserved.
  const re = /(<[^>]*>)|([^<]+)/g;
  const tokens: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    if (m[1]) tokens.push(m[1]);
    else if (m[2] && m[2].trim()) tokens.push(m[2].trim());
  }
  let pos = 0;
  return {
    tokens,
    pos,
    peek() { return pos < tokens.length ? tokens[pos] : null; },
    next() { return pos < tokens.length ? tokens[pos++] : null; },
  };
}

function parseElement(tokens: TokenStream): UIElementNode | null {
  const open = tokens.next();
  if (!open || !open.startsWith("<")) return null;
  const { tag, id, classes, selfClosed } = parseOpenTag(open);
  if (!SUPPORTED_TAGS.has(tag)) {
    throw new Error(`Unsupported tag <${tag}> — supported: ${[...SUPPORTED_TAGS].join(", ")}`);
  }
  const node: UIElementNode = { tag, id, classes, children: [] };

  if (selfClosed) return node;

  // Read children and text until matching close tag.
  while (true) {
    const peek = tokens.peek();
    if (peek === null) throw new Error(`Unclosed <${tag}>`);
    if (peek.startsWith(`</${tag}>`)) {
      tokens.next();
      return node;
    }
    if (peek.startsWith("<")) {
      const child = parseElement(tokens);
      if (child) node.children.push(child);
    } else {
      // Text content.
      node.text = peek;
      tokens.next();
    }
  }
}

function parseOpenTag(open: string): {
  tag: string; id?: string; classes: string[]; selfClosed: boolean;
} {
  const inner = open.slice(1, open.endsWith("/>") ? -2 : -1).trim();
  const selfClosed = open.endsWith("/>");
  const parts = inner.split(/\s+/);
  const tag = parts[0];
  let id: string | undefined;
  const classes: string[] = [];
  for (let i = 1; i < parts.length; i++) {
    const attr = parts[i];
    const idM = /^id="([^"]*)"$/.exec(attr);
    const classM = /^class="([^"]*)"$/.exec(attr);
    if (idM) id = idM[1];
    else if (classM) classes.push(...classM[1].split(/\s+/).filter(Boolean));
  }
  return { tag, id, classes, selfClosed };
}
