import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { loadUIModuleFromText, lowerOnMount } from "../../../packages/cuttlefish/src/ui/ui-registry";
import { splitUiFile } from "../../../packages/cuttlefish/src/ui/ui-file-splitter";

function tmpUi(src: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ui-"));
  const p = path.join(dir, "x.ui");
  fs.writeFileSync(p, src);
  return p;
}

describe("viewport-overflow diagnostic", () => {
  it("warns when a node's box bottom exceeds the viewport height", () => {
    // 4 rows of 80px content in a 100px-tall viewport → rows 2-4 overflow.
    const src = `<script>import { ui } from '@typecad/ui'; ui.mount(screen);</script>
<style>screen{flex-direction:column;gap:4px;padding:8px} .r{height:80px;width:200px;background:#ccc}</style>
<screen><body><div class="r"></div><div class="r"></div><div class="r"></div><div class="r"></div></body></screen>`;
    const uiPath = tmpUi(src);
    const parts = splitUiFile(fs.readFileSync(uiPath, "utf-8"));
    const htmlPath = uiPath + ".html";
    loadUIModuleFromText(htmlPath, parts.html, parts.style, uiPath);
    const lowered = lowerOnMount(htmlPath, { colorFormat: "rgb565", storage: "flash", viewport: { width: 240, height: 100 } });
    expect(lowered.diagnostics.some(d => d.code === "layout-viewport-overflow")).toBe(true);
  });

  it("does not warn when everything fits", () => {
    const src = `<script>import { ui } from '@typecad/ui'; ui.mount(screen);</script>
<style>screen{flex-direction:column;padding:8px} .r{height:20px;width:200px;background:#ccc}</style>
<screen><body><div class="r"></div></body></screen>`;
    const uiPath = tmpUi(src);
    const parts = splitUiFile(fs.readFileSync(uiPath, "utf-8"));
    const htmlPath = uiPath + ".html";
    loadUIModuleFromText(htmlPath, parts.html, parts.style, uiPath);
    const lowered = lowerOnMount(htmlPath, { colorFormat: "rgb565", storage: "flash", viewport: { width: 240, height: 100 } });
    expect(lowered.diagnostics.some(d => d.code === "layout-viewport-overflow")).toBe(false);
  });
});
