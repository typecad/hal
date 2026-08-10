import { describe, expect, it } from "vitest";
import { parseHtml } from "@typecad/ui/ui-engine/html-parser";
import { resolveStyles } from "@typecad/ui/ui-engine/style-resolver";

// The UA (User-Agent) stylesheet gives elements sensible built-in behavior
// before any user CSS. These tests lock down UA defaults that user CSS relies
// on, so a regression in the UA rules surfaces immediately.

describe("UA stylesheet defaults", () => {
  it("does NOT force white-space:nowrap on headings (long headings must be able to wrap)", () => {
    // Regression guard: an earlier fix added white-space:nowrap to the UA h1-h6
    // rules to stop a short heading wrapping inside a shrink-wrapped box. That
    // was the wrong layer — it forced long descriptive headings (e.g.
    // "width / height / min / max") to overflow their container instead of
    // wrapping, breaking the container's border. The shrink-wrap case is now
    // handled by measuring custom-font text at its real glyph advance (so the
    // box fits the text and there's nothing to wrap). Headings must therefore
    // wrap by default; a project opts into nowrap per-heading in its own CSS.
    for (const tag of ["h1", "h2", "h3", "h4", "h5", "h6"]) {
      const html = `<screen><${tag} id="h">Heading</${tag}></screen>`;
      const styled = resolveStyles(parseHtml(html), []);
      expect(styled.children[0].style.whiteSpace, `${tag} should not be nowrap via UA`).toBeUndefined();
    }
  });

  it("underlines <a> links by default", () => {
    const html = `<screen><a id="link" href="#x">link</a></screen>`;
    const styled = resolveStyles(parseHtml(html), []);
    expect(styled.children[0].style.textDecoration).toBe("underline");
  });
});
