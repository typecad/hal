// Pre-packaged themes: CSS files shipped in @typecad/ui/themes/, imported by
// bare package specifier (@import "@typecad/ui/themes/blue.css") and resolved
// through node_modules during import expansion.
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildPreviewSnapshot } from "@typecad/ui/preview/build-program";
import { expandCssImports } from "@typecad/ui/ui-engine/css-imports";
import { parseCss } from "@typecad/ui/ui-engine/css-parser";

// Package resolution must walk up to the repo's node_modules — keep the temp
// project INSIDE the repo tree.
const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "../../..");
const THEMES_DIR = path.resolve(REPO_ROOT, "packages/ui/themes");

let dir: string;
const dirs: string[] = [];

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(HERE, "cf-themes-"));
  dirs.push(dir);
});

afterAll(() => {
  for (const d of dirs) fs.rmSync(d, { recursive: true, force: true });
});

describe("pre-packaged theme inventory", () => {
  it("ships the expected set", () => {
    const names = fs.readdirSync(THEMES_DIR).filter((f) => f.endsWith(".css")).sort();
    expect(names).toEqual(["blue.css", "gray.css", "green.css", "neutral.css", "red.css", "slate.css", "stone.css", "zinc.css"]);
  });

  it("every theme parses cleanly and feeds the variable map", () => {
    // :root/.dark blocks are extracted into the custom-property map (they are
    // not styling rules), so each theme is parsed alongside a probe rule that
    // consumes var(--primary) — the resolved value proves the tokens landed.
    for (const f of fs.readdirSync(THEMES_DIR)) {
      if (!f.endsWith(".css")) continue;
      const text = fs.readFileSync(path.join(THEMES_DIR, f), "utf-8");
      for (const token of ["--background", "--foreground", "--primary", "--primary-foreground", "--border", "--input"]) {
        expect(text, `${f} ${token}`).toContain(token + ":");
      }
      expect(text, f).toContain(":root {");
      expect(text, f).toContain(".dark {");
      const diags: unknown[] = [];
      const rules = parseCss(text + "\n.probe { color: var(--primary); }", diags as never);
      expect(diags, f).toEqual([]);
      const probe = rules.find((r: never) => JSON.stringify((r as unknown as { selector: unknown }).selector).includes("probe"));
      expect(probe, f).toBeDefined();
      expect((probe as unknown as { properties: Record<string, string> }).properties.color, f).not.toBe("var(--primary)");
    }
  });
});

describe("bare package specifier resolution", () => {
  it("loads a pre-packaged theme from node_modules", () => {
    const out = expandCssImports('@import "@typecad/ui/themes/blue.css";', dir);
    expect(out).toContain("--primary: 221.2 83.2% 53.3%");
  });

  it("drops unresolvable scaffolding specifiers silently", () => {
    expect(expandCssImports('@import "tailwindcss";', dir).trim()).toBe("");
  });
});

describe("pre-packaged theme through the snapshot builder", () => {
  it("overrides kit tokens by cascade (device + preview parity path)", async () => {
    fs.writeFileSync(path.join(dir, "app.ui"), `
<screen id="s">
  <body>
    <button id="b" class="btn btn-primary">Save</button>
  </body>
</screen>
<style>
@import "@typecad/ui/themes/blue.css";
</style>`);
    const snap = await buildPreviewSnapshot({
      config: { entry: "./app.ui", display: { themeClass: "dark" }, configPath: path.join(dir, "cuttlefish.config.ts") } as never,
      projectRoot: dir,
    });
    const btn = snap.program.nodes.find((n) => n.id === "b");
    expect(btn).toBeDefined();
    // Blue dark primary: hsl(217.9 91.2% 59.8%) ≈ #3b82f6 → rgb565 0x2bfdish.
    // Assert it differs from BOTH the kit default dark primary (#fafafa) and
    // the light blue primary, then pin the exact resolved value.
    expect(btn!.bg).not.toBe(65503); // kit dark primary
    const { resolveColor } = await import("@typecad/ui/ui-engine/color");
    expect(btn!.bg).toBe(resolveColor("hsl(217.9 91.2% 59.8%)", "rgb565"));
  });
});
