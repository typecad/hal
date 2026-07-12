import { describe, it, expect } from "vitest";
import { measure } from "../../../packages/ui/src/ui-engine/layout-engine";
import { resolveStyles } from "../../../packages/ui/src/ui-engine/style-resolver";
import { parseHtml } from "../../../packages/ui/src/ui-engine/html-parser";
import { parseCss } from "../../../packages/ui/src/ui-engine/css-parser";

function measureText(src: string, css: string) {
  const styled = resolveStyles(parseHtml(src), parseCss(css));
  return measure(styled.children[0] ?? styled);
}

describe("interpolation measurement", () => {
  it("a token interpolation measures the same as the same text without braces", () => {
    // 'taps: {count}' should measure as 'taps: count' (no braces), not the
    // full literal. The braces are an authoring delimiter, not rendered.
    const interp = measureText(`<screen><text>taps: {count}</text></screen>`, `text{font-size:16px}`);
    const literal = measureText(`<screen><text>taps: count</text></screen>`, `text{font-size:16px}`);
    expect(interp.w).toBe(literal.w);
  });
});
