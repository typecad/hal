import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseCss, parseFontFaces } from "@typecad/cuttlefish/ui/css-parser";
import { parseHtml } from "@typecad/cuttlefish/ui/html-parser";
import { resolveStyles } from "@typecad/cuttlefish/ui/style-resolver";
import {
  planUIFontAssets,
  selectFontAssetForStyle,
} from "../../../packages/cuttlefish/src/ui/font-assets";

function withFontFiles(names: string[], run: (dir: string) => void): void {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "typecad-font-assets-"));
  try {
    for (const name of names) fs.writeFileSync(path.join(dir, name), "");
    run(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function plan(html: string, css: string, dir: string) {
  const styled = resolveStyles(parseHtml(html), parseCss(css));
  return planUIFontAssets(styled, parseFontFaces(css), dir);
}

describe("UI font asset planning", () => {
  it("plans exact static glyph subsets by default, including one-symbol text", () => {
    withFontFiles(["icons.ttf"], (dir) => {
      const plans = plan(
        `<screen><text id="icon">✓</text></screen>`,
        `
          @font-face { font-family: "Icons"; src: url("icons.ttf"); }
          #icon { font-family: "Icons"; font-size: 18px; }
        `,
        dir,
      );

      expect(plans).toHaveLength(1);
      expect(plans[0].subset).toBe("exact");
      expect(plans[0].chars).toEqual(["✓"]);
    });
  });

  it("adds the common ASCII fallback only when font-subset requests it", () => {
    withFontFiles(["icons.ttf"], (dir) => {
      const plans = plan(
        `<screen><text id="icon">✓</text></screen>`,
        `
          @font-face { font-family: "Icons"; src: url("icons.ttf"); }
          #icon { font-family: "Icons"; font-size: 18px; font-subset: fallback; }
        `,
        dir,
      );

      expect(plans[0].subset).toBe("fallback");
      expect(plans[0].chars).toContain("✓");
      expect(plans[0].chars).toContain("A");
      expect(plans[0].chars).toContain("0");
    });
  });

  it("plans transformed text, not the pre-transform source text", () => {
    withFontFiles(["sans.ttf"], (dir) => {
      const plans = plan(
        `<screen><text id="label">ok</text></screen>`,
        `
          @font-face { font-family: "Sans"; src: url("sans.ttf"); }
          #label { font-family: "Sans"; font-size: 16px; text-transform: uppercase; }
        `,
        dir,
      );

      expect(plans[0].chars).toEqual(["K", "O"]);
    });
  });

  it("separates used font variants by weight and style", () => {
    withFontFiles(["regular.ttf", "bold.ttf", "italic.ttf"], (dir) => {
      const plans = plan(
        `
          <screen>
            <text id="normal">N</text>
            <text id="bold">B</text>
            <text id="italic">I</text>
          </screen>
        `,
        `
          @font-face { font-family: "Sans"; src: url("regular.ttf"); font-weight: 400; font-style: normal; }
          @font-face { font-family: "Sans"; src: url("bold.ttf"); font-weight: 700; font-style: normal; }
          @font-face { font-family: "Sans"; src: url("italic.ttf"); font-weight: 400; font-style: italic; }
          text { font-family: "Sans"; font-size: 16px; }
          #bold { font-weight: bold; }
          #italic { font-style: italic; }
        `,
        dir,
      );

      expect(plans.map((p) => path.basename(p.sourcePath)).sort()).toEqual(["bold.ttf", "italic.ttf", "regular.ttf"]);
      expect(plans.find((p) => path.basename(p.sourcePath) === "bold.ttf")?.fontWeight).toBe("700");
      expect(plans.find((p) => path.basename(p.sourcePath) === "italic.ttf")?.fontStyle).toBe("italic");
    });
  });

  it("selects the best generated font asset for a styled node", () => {
    const asset = selectFontAssetForStyle([
      { id: 1, family: "Sans", sourcePath: "regular.ttf", px: 16, fontWeight: "400", fontStyle: "normal", subset: "exact", lineHeight: 18, baseline: 14, glyphs: [], alpha: [] },
      { id: 2, family: "Sans", sourcePath: "bold.ttf", px: 16, fontWeight: "700", fontStyle: "normal", subset: "exact", lineHeight: 18, baseline: 14, glyphs: [], alpha: [] },
    ], { fontFamily: '"Sans"', fontSize: "16px", fontWeight: "bold" });

    expect(asset?.id).toBe(2);
  });
});
