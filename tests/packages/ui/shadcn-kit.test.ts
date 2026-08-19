// The built-in shadcn kit: tokens + recipes are prepended to every build and
// preview automatically (no scaffolding, no imports), user CSS overrides them
// by cascade order, and themes are plain CSS files whose :root/.dark blocks
// simply win the cascade. These tests drive the REAL preview snapshot
// builder against a temp project, exercising the same injection the device
// build uses.
import { describe, it, expect, beforeEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildPreviewSnapshot } from "@typecad/ui/preview/build-program";
import { expandCssImports } from "@typecad/ui/ui-engine/css-imports";
import { SHADCN_KIT_CSS } from "@typecad/ui/ui-engine/shadcn-kit";

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "cf-kit-"));
});

interface MiniConfig {
  entry: string;
  display?: Record<string, unknown>;
}

function configFor(): MiniConfig {
  return { entry: "./app.ui", display: { themeClass: "dark" }, configPath: path.join(dir, "cuttlefish.config.ts") } as never;
}

async function build(config: MiniConfig) {
  return buildPreviewSnapshot({ config: config as never, projectRoot: dir });
}

describe("built-in shadcn kit", () => {
  it("styles kit classes with ZERO imports (transparent default)", async () => {
    fs.writeFileSync(path.join(dir, "app.ui"), `
<screen id="s">
  <body>
    <button id="b" class="btn btn-primary">Save</button>
  </body>
</screen>`);
    const snap = await build(configFor());
    const btn = snap.program.nodes.find((n) => n.id === "b");
    expect(btn).toBeDefined();
    // Kit dark tokens: primary #fafafa -> rgb565 65503 (0xffdf).
    expect(btn!.bg).toBe(65503);
    // The kit's .btn recipe carries the pressed transform + border.
    expect(btn!.borderStyle).toBeGreaterThan(0);
    expect(btn!.pressedOffsetY).not.toBe(0);
  });

  it("a plain theme file overrides kit tokens through the cascade", async () => {
    fs.writeFileSync(path.join(dir, "theme.css"), `
@import "tailwindcss";

:root { --primary: #c25e00; --radius: 6px; }
.dark { --primary: #ffcc00; --radius: 6px; }
`);
    fs.writeFileSync(path.join(dir, "app.ui"), `
<screen id="s">
  <body>
    <button id="b" class="btn btn-primary">Save</button>
  </body>
</screen>
<style>
@import "./theme.css";
</style>`);
    const snap = await build(configFor());
    const btn = snap.program.nodes.find((n) => n.id === "b");
    // Theme dark primary #ffcc00 -> rgb565 0xfe60 (65120); the bare
    // "tailwindcss" import is dropped silently (no warning, no resolution).
    expect(btn!.bg).toBe(0xfe60);
    expect(btn!.borderRadius).toBe(6);
  });

  it("user rules override kit recipes (later definitions win)", async () => {
    fs.writeFileSync(path.join(dir, "app.ui"), `
<screen id="s">
  <body>
    <button id="b" class="btn btn-primary">Save</button>
  </body>
</screen>
<style>
.btn { border-radius: 20px; }
</style>`);
    const snap = await build(configFor());
    const btn = snap.program.nodes.find((n) => n.id === "b");
    expect(btn!.borderRadius).toBe(20);
  });
});

describe("css import normalization", () => {
  it("drops bare module specifiers, keeps path-like imports", () => {
    const out = expandCssImports('@import "tailwindcss";\n@import "./real.css";\nx {}', dir);
    expect(out).not.toContain("tailwindcss");
    // ./real.css doesn't exist here — the statement stays for the warning.
    expect(out).toContain("./real.css");
  });

  it("the kit itself contains no @import statements (prepended raw; header mentions don't count)", () => {
    expect(SHADCN_KIT_CSS).not.toMatch(/^\s*@import/m);
  });
});
