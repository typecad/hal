import { describe, expect, it } from "vitest";
import { parseHtml } from "@typecad/cuttlefish/ui/html-parser";
import { resolveStyles } from "@typecad/cuttlefish/ui/style-resolver";

// The UA (User-Agent) stylesheet gives elements sensible built-in behavior
// before any user CSS. These tests lock down UA defaults that user CSS relies
// on, so a regression in the UA rules surfaces immediately.

describe("UA stylesheet defaults", () => {
  it("applies white-space: nowrap to every heading (h1-h6) so headings never wrap", () => {
    // Regression: heading text-nodes shrink-wrap their box to the measured text
    // width, so a heading whose box lands near its text width wrapped onto two
    // lines (e.g. italic "H6 heading"). Headings are single-line by nature, so
    // the UA stylesheet forces nowrap on h1-h6. User CSS still overrides it.
    for (const tag of ["h1", "h2", "h3", "h4", "h5", "h6"]) {
      const html = `<screen><${tag} id="h">Heading</${tag}></screen>`;
      const styled = resolveStyles(parseHtml(html), []);
      const node = styled.children[0];
      expect(node.style.whiteSpace, `${tag} should be nowrap via UA`).toBe("nowrap");
    }
  });

  it("underlines <a> links by default", () => {
    const html = `<screen><a id="link" href="#x">link</a></screen>`;
    const styled = resolveStyles(parseHtml(html), []);
    expect(styled.children[0].style.textDecoration).toBe("underline");
  });
});
