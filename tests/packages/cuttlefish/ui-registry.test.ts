import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  resetUIRegistry,
  loadUIModule,
  getUIModule,
  hasUIModule,
  lowerOnMount,
  markEntryHasUI,
  entryHasUI,
  clearEntryHasUI,
} from "@typecad/cuttlefish/ui/ui-registry";

const tempDirs: string[] = [];
afterEach(() => {
  for (const d of tempDirs.splice(0, tempDirs.length)) {
    fs.rmSync(d, { recursive: true, force: true });
  }
});

function writeProject(html: string, css: string): { dir: string; htmlPath: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "typehal-ui-reg-"));
  tempDirs.push(dir);
  const htmlPath = path.join(dir, "app.ui.html");
  const cssPath = path.join(dir, "app.ui.css");
  fs.writeFileSync(htmlPath, html, "utf-8");
  fs.writeFileSync(cssPath, css, "utf-8");
  return { dir, htmlPath };
}

describe("UI module registry", () => {
  beforeEach(() => {
    resetUIRegistry();
    clearEntryHasUI();
  });

  it("loadUIModule parses .ui.html + sibling .ui.css into a styled tree", () => {
    const { htmlPath } = writeProject(
      `<screen><text id="greeting">hi</text></screen>`,
      `#greeting { color: #ff0000; font: 8x16; }`,
    );
    const mod = loadUIModule(htmlPath);
    expect(mod.styled.tag).toBe("screen");
    expect(mod.styled.children[0].id).toBe("greeting");
    expect(mod.styled.children[0].style.color).toBe("#ff0000");
  });

  it("caches by path — second loadUIModule returns the same module", () => {
    const { htmlPath } = writeProject(`<screen></screen>`, ``);
    const a = loadUIModule(htmlPath);
    const b = loadUIModule(htmlPath);
    expect(a).toBe(b); // referentially identical — cached
  });

  it("hasUIModule / getUIModule reflect registry state", () => {
    const { htmlPath } = writeProject(`<screen></screen>`, ``);
    expect(hasUIModule(htmlPath)).toBe(false);
    loadUIModule(htmlPath);
    expect(hasUIModule(htmlPath)).toBe(true);
    expect(getUIModule(htmlPath)).toBeDefined();
  });

  it("loadUIModule works with no sibling .ui.css (empty rules)", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "typehal-ui-reg-"));
    tempDirs.push(dir);
    const htmlPath = path.join(dir, "app.ui.html");
    fs.writeFileSync(htmlPath, `<screen></screen>`, "utf-8");
    const mod = loadUIModule(htmlPath);
    expect(mod.styled.tag).toBe("screen");
  });

  it("writes a .ui.html.d.ts sibling with ScreenTree fields", () => {
    const { dir, htmlPath } = writeProject(
      `<screen><text id="greeting">hi</text><button id="btn">x</button></screen>`,
      ``,
    );
    loadUIModule(htmlPath);
    const dtsPath = path.join(dir, "app.ui.html.d.ts");
    expect(fs.existsSync(dtsPath)).toBe(true);
    const dts = fs.readFileSync(dtsPath, "utf-8");
    expect(dts).toContain("ScreenTree");
    expect(dts).toContain("greeting");
    expect(dts).toContain("btn");
  });

  it("lowerOnMount produces the lowered C++ tables using the mount viewport", () => {
    const { htmlPath } = writeProject(
      `<screen><text id="greeting">hello</text></screen>`,
      `screen { background: #008000; } #greeting { color: #ff0000; font: 8x16; }`,
    );
    loadUIModule(htmlPath);
    const lowered = lowerOnMount(htmlPath, {
      colorFormat: "rgb565",
      storage: "flash",
      viewport: { width: 240, height: 320 },
    });
    expect(lowered.nodeTable).toMatch(/UINode\s+__ui_nodes/);
    expect(lowered.nodeTable).toContain("0x0400"); // #008000 → 0x0400
    expect(lowered.nodeTable).toContain("0xf800"); // #ff0000 → 0xf800
    expect(lowered.nodeTable).toContain("hello");
  });

  it("entry-has-UI flag is off until markEntryHasUI", () => {
    expect(entryHasUI()).toBe(false);
    markEntryHasUI();
    expect(entryHasUI()).toBe(true);
    clearEntryHasUI();
    expect(entryHasUI()).toBe(false);
  });

  it("resetUIRegistry clears all modules and the entry flag", () => {
    const { htmlPath } = writeProject(`<screen></screen>`, ``);
    loadUIModule(htmlPath);
    markEntryHasUI();
    expect(hasUIModule(htmlPath)).toBe(true);
    expect(entryHasUI()).toBe(true);
    resetUIRegistry();
    expect(hasUIModule(htmlPath)).toBe(false);
    expect(entryHasUI()).toBe(false);
  });
});
