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
  allUIModules,
  generateProjectUITypeDeclarations,
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

  it("writes a generated .ui.d.html.ts file under types/ with ScreenTree fields", () => {
    const { dir, htmlPath } = writeProject(
      `<screen><text id="greeting">hi</text><button id="btn">x</button></screen>`,
      ``,
    );
    loadUIModule(htmlPath);
    const dtsPath = path.join(dir, "types", "app.ui.d.html.ts");
    expect(fs.existsSync(dtsPath)).toBe(true);
    const dts = fs.readFileSync(dtsPath, "utf-8");
    expect(dts).toContain("ScreenTree");
    expect(dts).toContain("greeting");
    expect(dts).toContain("btn");
  });

  it("generates project UI type declarations under types/ without registering modules", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "typehal-ui-reg-"));
    tempDirs.push(dir);
    const srcDir = path.join(dir, "src");
    fs.mkdirSync(srcDir, { recursive: true });
    fs.writeFileSync(path.join(dir, "cuttlefish.config.ts"), "export default {};\n", "utf-8");
    fs.writeFileSync(
      path.join(srcDir, "nav.ui.html"),
      `<screen id="nav"><button ref="homeLink">Home</button></screen>`,
      "utf-8",
    );
    fs.writeFileSync(
      path.join(srcDir, "counter.ui"),
      `<script>export const count = 0;</script><screen id="counter"><text id="countText">0</text></screen>`,
      "utf-8",
    );

    const result = generateProjectUITypeDeclarations(dir);

    expect(result.errors).toEqual([]);
    expect(result.written.map(file => path.relative(dir, file).replace(/\\/g, "/")).sort()).toEqual([
      "types/counter.ui.d.html.ts",
      "types/nav.ui.d.html.ts",
    ]);
    expect(fs.readFileSync(path.join(dir, "types", "nav.ui.d.html.ts"), "utf-8")).toContain("homeLink");
    expect(fs.readFileSync(path.join(dir, "types", "counter.ui.d.html.ts"), "utf-8")).toContain("countText");
    expect(allUIModules()).toHaveLength(0);
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

  it("loads image assets by source and natural dimensions", () => {
    const { dir, htmlPath } = writeProject(
      `<screen>
        <img id="smallLogo" src="logo.img" width="2" height="2"></img>
        <img id="wideLogo" src="logo.img" width="3" height="2"></img>
      </screen>`,
      ``,
    );
    const pixels = Buffer.alloc(12);
    [0xf800, 0x07e0, 0x001f, 0xffff, 0xffe0, 0x0000].forEach((value, index) => {
      pixels.writeUInt16LE(value, index * 2);
    });
    fs.writeFileSync(path.join(dir, "logo.img"), pixels);

    loadUIModule(htmlPath);
    const lowered = lowerOnMount(htmlPath, {
      colorFormat: "rgb565",
      storage: "flash",
      viewport: { width: 20, height: 20 },
    });

    expect(lowered.imageTables).toContain("__ui_img_smallLogo_data");
    expect(lowered.imageTables).toContain("__ui_img_wideLogo_data");
    expect(lowered.imageTables).toContain("{ 2, 2, __ui_img_smallLogo_data }");
    expect(lowered.imageTables).toContain("{ 3, 2, __ui_img_wideLogo_data }");
    expect(lowered.nodeTable).toContain(".imgDataId=0");
    expect(lowered.nodeTable).toContain(".imgDataId=1");
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
