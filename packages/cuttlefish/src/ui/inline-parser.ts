import { Diagnostic } from "../types.js";

/** Tags whose content participates in inline flow inside a text container.
 *  Bare text nodes between them flow too. Recognized as inline children of a
 *  text-effective node; absorbed into the parent's run list by the resolver. */
export const INLINE_TAGS = new Set(["span", "a", "b", "strong", "i", "em", "u"]);

export type InlineItem =
  | { kind: "text"; text: string }
  | { kind: "element"; tag: string; origTag?: string; classes: string[];
      inlineStyle?: string; href?: string; inline?: InlineItem[] }
  | { kind: "break" };

/** Walk childNodes in document order, building an inline sequence.
 *
 *  Returns `undefined` when the element is NOT inline-bearing:
 *  - has any block-level child (a non-inline, non-br element) → block breaks
 *    the flow, so this element is treated as a container, not a rich-text node;
 *  - has no recognized inline element child at all → plain text, handled by the
 *    existing single-string text path.
 *
 *  Otherwise returns the ordered sequence of text fragments, inline elements
 *  (recursively), and hard-break markers (`<br>`). */
export function collectInlineSequence(el: Element, diagnostics: Diagnostic[]): InlineItem[] | undefined {
  const childElements = Array.from(el.children);
  const hasBlockChild = childElements.some(
    (c) => !INLINE_TAGS.has(c.tagName.toLowerCase()) && c.tagName.toLowerCase() !== "br",
  );
  if (hasBlockChild) return undefined;

  // Only build a sequence when there's at least one recognized inline element
  // child. A node with only bare text nodes is plain text (existing path).
  const hasInlineChild = childElements.some((c) => INLINE_TAGS.has(c.tagName.toLowerCase()));
  if (!hasInlineChild) return undefined;

  const seq: InlineItem[] = [];
  for (const child of Array.from(el.childNodes)) {
    const nodeType = (child as any).nodeType;
    if (nodeType === 3) {  // text node
      const text = child.textContent ?? "";
      if (text) seq.push({ kind: "text", text });
      continue;
    }
    const childTag = (child as Element).tagName?.toLowerCase();
    if (childTag === "br") {
      seq.push({ kind: "break" });
      continue;
    }
    if (childTag && INLINE_TAGS.has(childTag)) {
      const cel = child as Element;
      const classes = (cel.getAttribute("class") || "").split(/\s+/).filter(Boolean);
      const subInline = collectInlineSequence(cel, diagnostics);
      seq.push({
        kind: "element",
        tag: "text",
        origTag: childTag,
        classes,
        inlineStyle: cel.getAttribute("style") || undefined,
        href: childTag === "a" ? (cel.getAttribute("href") || undefined) : undefined,
        inline: subInline,
      });
    }
    // Other node types (comments, unknown elements already filtered) are ignored.
  }
  return seq;
}
