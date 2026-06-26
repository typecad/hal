import { describe, it, expect } from "vitest";
import { resolveStyles } from "@typecad/cuttlefish/ui/style-resolver";
import { parseHtml } from "@typecad/cuttlefish/ui/html-parser";
import { parseCss } from "@typecad/cuttlefish/ui/css-parser";

function resolve(src: string, css: string) {
  return resolveStyles(parseHtml(src), parseCss(css));
}

describe("style resolver", () => {
  it("applies element selector to all matching tags", () => {
    const styled = resolve(`<screen><text id="t">hi</text></screen>`, `screen { padding: 8; }`);
    expect(styled.style.padding).toBe("8");
  });

  it("applies id selector", () => {
    const styled = resolve(`<screen><text id="t">hi</text></screen>`, `#t { color: #ff0000; }`);
    expect(styled.children[0].style.color).toBe("#ff0000");
  });

  it("applies class selector", () => {
    const styled = resolve(`<screen><view class="card"></view></screen>`, `.card { padding: 4; }`);
    expect(styled.children[0].style.padding).toBe("4");
  });

  it("later rules override earlier rules (cascade)", () => {
    const styled = resolve(
      `<screen><text id="t">hi</text></screen>`,
      `#t { color: #ff0000; } #t { color: #00ff00; }`,
    );
    expect(styled.children[0].style.color).toBe("#00ff00");
  });

  it("base state and :pressed state resolve separately", () => {
    const styled = resolve(
      `<screen><button id="btn">x</button></screen>`,
      `#btn { background: #404040; } #btn:pressed { background: #808080; }`,
    );
    const btn = styled.children[0];
    expect(btn.style.background).toBe("#404040");
    expect(btn.style.pressed?.background).toBe("#808080");
  });

  it("maps the hidden attribute to display none after inline styles", () => {
    const styled = resolve(
      `<screen><view id="panel" hidden style="display: flex"></view></screen>`,
      ``,
    );
    expect(styled.children[0].style.display).toBe("none");
  });
});
