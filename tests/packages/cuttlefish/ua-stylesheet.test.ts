import { describe, expect, it } from "vitest";
import { parseHtml } from "@typecad/ui/ui-engine/html-parser";
import { parseCss, resetRegisteredThemeVars } from "@typecad/ui/ui-engine/css-parser";
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

  it("resolves its var() tokens against the user CSS theme variables", () => {
    // The UA stylesheet is parsed standalone (no :root of its own), so its
    // var(--x) references must resolve against the variables the user CSS
    // registered — a theme palette alone should re-theme the whole app.
    const html = `<screen><button id="btn">Go</button></screen>`;
    const rules = parseCss(`:root { --primary: #ff00aa; --primary-foreground: #000000; --radius: 10px; }`);
    const styled = resolveStyles(parseHtml(html), rules);
    const btn = styled.children[0];
    expect(btn.style.background).toBe("#ff00aa");
    expect(btn.style.color).toBe("#000000");
    expect(btn.style.borderRadius).toBe("10px");
  });

  it("falls back to a default when a token is not defined by the theme", () => {
    // Projects that don't define every token still get sensible UA defaults.
    // Reset the cross-source registry so the previous test's palette doesn't
    // leak into this one (the registry is process-global by design).
    resetRegisteredThemeVars();
    const html = `<screen><button id="btn">Go</button></screen>`;
    const styled = resolveStyles(parseHtml(html), []);
    const btn = styled.children[0];
    expect(btn.style.background).toBe("#2563eb");
    expect(btn.style.borderRadius).toBe("0px");
  });
});
