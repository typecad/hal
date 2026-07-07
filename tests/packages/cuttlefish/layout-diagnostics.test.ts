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

  it("message references the node by id/tag/text, not bare node index", () => {
    // An author can't find "node 318" in their source. The message must use a
    // human-referenceable label: #id when present, else <tag "text">, else <tag>.
    const src = `<script>import { ui } from '@typecad/ui'; ui.mount(screen);</script>
<style>screen{flex-direction:column;gap:4px;padding:8px} #tall{height:150px;width:200px;background:#ccc}</style>
<screen><body><div id="tall"></div></body></screen>`;
    const uiPath = tmpUi(src);
    const parts = splitUiFile(fs.readFileSync(uiPath, "utf-8"));
    const htmlPath = uiPath + ".html";
    loadUIModuleFromText(htmlPath, parts.html, parts.style, uiPath);
    const lowered = lowerOnMount(htmlPath, { colorFormat: "rgb565", storage: "flash", viewport: { width: 240, height: 100 } });
    const d = lowered.diagnostics.find(d => d.code === "layout-viewport-overflow");
    expect(d).toBeDefined();
    // The message must include "#tall" (the id) so the author can grep for it.
    expect(d!.message).toContain("#tall");
    // And must NOT use the bare "node N" phrasing.
    expect(d!.message).not.toMatch(/^node \d+ /);
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

  it("warns when a text node's measured width exceeds its parent content box", () => {
    // 'tap me' (button) + 'taps: {count}' literal text in a narrow card
    // → the row's content exceeds the card content box width.
    const src = `<script>import { ui } from '@typecad/ui'; ui.mount(screen);
      export const count = ui.signal(0);</script>
<style>screen{flex-direction:column;padding:8px}
.card{width:120px;padding:4px;background:#ccc}
.row{flex-direction:row;justify-content:space-between;gap:6px}</style>
<screen><body>
  <div class="card"><div class="row"><button>tap me</button><text>taps: {count}</text></div></div>
</body></screen>`;
    const uiPath = tmpUi(src);
    const parts = splitUiFile(fs.readFileSync(uiPath, "utf-8"));
    const htmlPath = uiPath + ".html";
    loadUIModuleFromText(htmlPath, parts.html, parts.style, uiPath);
    const lowered = lowerOnMount(htmlPath, { colorFormat: "rgb565", storage: "flash", viewport: { width: 240, height: 200 } });
    expect(lowered.diagnostics.some(d => d.code === "layout-text-overflow")).toBe(true);
  });

  it("does NOT warn for nodes inside a scroll container (off-screen-below-fold is expected)", () => {
    // A scroll container's children are INTENTIONALLY taller than the viewport —
    // that's the whole point of scroll. The viewport-overflow diagnostic must
    // suppress nodes whose ancestor chain crosses an overflow:scroll container.
    const src = `<script>import { ui } from '@typecad/ui'; ui.mount(screen);</script>
<style>screen{flex-direction:column;padding:8px}
.scroll{overflow:scroll;height:100px;width:200px;background:#ccc}
.noscroll{height:100px;width:200px;background:#ccc}
.deep{height:80px;width:180px;background:#aaa}</style>
<screen><body>
  <div id="scroller" class="scroll">
    <div id="scroll_child" class="deep"></div>
    <div id="scroll_grandchild" class="deep"></div>
  </div>
  <div id="plain" class="noscroll">
    <div id="plain_child" class="deep"></div>
  </div>
</body></screen>`;
    const uiPath = tmpUi(src);
    const parts = splitUiFile(fs.readFileSync(uiPath, "utf-8"));
    const htmlPath = uiPath + ".html";
    loadUIModuleFromText(htmlPath, parts.html, parts.style, uiPath);
    const lowered = lowerOnMount(htmlPath, { colorFormat: "rgb565", storage: "flash", viewport: { width: 240, height: 100 } });
    const msgs = lowered.diagnostics.filter(d => d.code === "layout-viewport-overflow").map(d => d.message);
    // Scroll-container children (and the scroller itself) must NOT warn.
    expect(msgs.some(m => m.includes("#scroll_child"))).toBe(false);
    expect(msgs.some(m => m.includes("#scroll_grandchild"))).toBe(false);
    expect(msgs.some(m => m.includes("#scroller"))).toBe(false);
    // Non-scroll overflow still warns (the diagnostic's actual job).
    // (plain_child sits inside #plain, a non-scroll 100px container in a 100px
    // viewport; whether it overflows depends on exact layout, so we only assert
    // the suppression — the positive case is covered by the other tests.)
  });
});
