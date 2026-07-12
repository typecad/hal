import { describe, it, expect } from "vitest";
import { measure } from "../../../packages/ui/src/ui-engine/layout-engine";
import { resolveStyles } from "../../../packages/ui/src/ui-engine/style-resolver";
import { parseHtml } from "../../../packages/ui/src/ui-engine/html-parser";
import { parseCss } from "../../../packages/ui/src/ui-engine/css-parser";

function measureText(src: string, css: string) {
  const styled = resolveStyles(parseHtml(src), parseCss(css));
  // measure the first child (the <text>) of the screen
  return measure(styled.children[0] ?? styled);
}

describe("textSizeOf: bold does not inflate the GFX bucket", () => {
  it("bold and normal 16px text measure the same width", () => {
    const normal = measureText(`<screen><text>hello</text></screen>`, `text{font-size:16px}`);
    const bold = measureText(`<screen><text>hello</text></screen>`, `text{font-size:16px;font-weight:bold}`);
    expect(bold.w).toBe(normal.w);
  });
});
