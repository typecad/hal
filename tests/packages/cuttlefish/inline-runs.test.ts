import { describe, it, expect } from "vitest";
import { resolveStyles } from "@typecad/cuttlefish/ui/style-resolver";
import { parseHtml } from "@typecad/cuttlefish/ui/html-parser";
import { parseCss } from "@typecad/cuttlefish/ui/css-parser";

function resolve(src: string, css: string) {
  return resolveStyles(parseHtml(src), parseCss(css));
}

describe("inline run absorption", () => {
  it("absorbs <b> into a bold run on the parent text node", () => {
    const styled = resolve(`<screen><p id="p">Hello <b>world</b></p></screen>`, ``);
    const p = styled.children[0];
    expect(p.runs).toBeDefined();
    expect(p.runs!.length).toBe(2);
    expect(p.runs![0].text).toBe("Hello ");
    expect(p.runs![1].text).toBe("world");
    expect(p.runs![1].style.fontWeight).toBe("bold");  // b default
    // The b is absorbed — no separate child node.
    expect(p.children).toEqual([]);
    expect(p.text).toBeUndefined();
  });

  it("applies i/em/u defaults", () => {
    const styled = resolve(`<screen><p id="p"><i>i</i><em>e</em><u>u</u></p></screen>`, ``);
    const runs = styled.children[0].runs!;
    expect(runs[0].style.fontStyle).toBe("italic");
    expect(runs[1].style.fontStyle).toBe("italic");
    expect(runs[2].style.textDecoration).toBe("underline");
  });

  it("nested inline merges styles (b > i → bold + italic)", () => {
    const styled = resolve(`<screen><p id="p">x <b>bold <i>both</i></b></p></screen>`, ``);
    const runs = styled.children[0].runs!;
    // "x ", "bold " (bold), "both" (bold+italic)
    const both = runs.find(r => r.text === "both")!;
    expect(both).toBeDefined();
    expect(both.style.fontWeight).toBe("bold");
    expect(both.style.fontStyle).toBe("italic");
  });

  it("a run inherits the parent text node's color and a run can override", () => {
    const styled = resolve(
      `<screen><p id="p" style="color:#ff0000">a <b>b</b> <span style="color:#00ff00">c</span></p></screen>`,
      ``,
    );
    const runs = styled.children[0].runs!;
    expect(runs.find(r => r.text === "a ")!.style.color).toBe("#ff0000");  // inherited from p
    expect(runs.find(r => r.text === "b")!.style.color).toBe("#ff0000");   // inherited (b adds bold only)
    expect(runs.find(r => r.text === "c")!.style.color).toBe("#00ff00");   // overridden by span inline style
  });

  it("carries href onto <a> runs", () => {
    const styled = resolve(`<screen><p id="p">see <a href="#home">link</a></p></screen>`, ``);
    const runs = styled.children[0].runs!;
    const link = runs.find(r => r.text === "link")!;
    expect(link.href).toBe("#home");
  });

  it("<br> becomes a hard-break run", () => {
    const styled = resolve(`<screen><p id="p">a<br>b</p></screen>`, ``);
    const runs = styled.children[0].runs!;
    expect(runs.find(r => r.hardBreak)).toBeDefined();
  });

  it("plain text node has no runs (regression guard)", () => {
    const styled = resolve(`<screen><text id="t">hi</text></screen>`, ``);
    expect(styled.children[0].runs).toBeUndefined();
    expect(styled.children[0].text).toBe("hi");
  });

  it("class selector on an inline element styles its run", () => {
    const styled = resolve(
      `<screen><p id="p">a <b class="big">b</b></p></screen>`,
      `.big { font-size: 24px; }`,
    );
    const runs = styled.children[0].runs!;
    const big = runs.find(r => r.text === "b")!;
    expect(big.style.fontSize).toBe("24px");
  });

  it("origTag element selector styles matching inline runs (e.g. b {...})", () => {
    const styled = resolve(
      `<screen><p id="p">a <b>b</b></p></screen>`,
      `b { color: #ff0000; }`,
    );
    const runs = styled.children[0].runs!;
    const b = runs.find(r => r.text === "b")!;
    expect(b.style.color).toBe("#ff0000");
  });
});
