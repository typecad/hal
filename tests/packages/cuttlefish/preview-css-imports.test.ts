// Preview @import + interactive-node wiring diagnostics.
//
// 1. A `@import` inside a .ui <style> must be expanded BEFORE parsing (parity
//    with the CLI build's loadUIModuleFromText). The preview used to leave the
//    import literal, so kit tokens never loaded and model lowering rejected the
//    raw `var(--x)` color strings — a project that built for device crashed the
//    preview.
// 2. on:*/bind:*/{expr} features resolve their node by id in the preview; an
//    id-less interactive node is silently inert, so the preview now warns.
import { describe, expect, it, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildPreviewSnapshot } from "../../../packages/ui/src/preview/build-program";
import { parseConfigFile } from "../../../packages/cuttlefish/src/config-loader";

let tmp: string;

beforeAll(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cf-preview-import-"));
});

afterAll(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

function writeProject(name: string, files: Record<string, string>): { configDir: string } {
  const dir = path.join(tmp, name);
  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(dir, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
  }
  return { configDir: dir };
}

const CONFIG = `
import type { CuttlefishConfig } from '@typecad/cuttlefish/api';
const config: CuttlefishConfig = {
  entry: './src/app.ui',
  target: 'esp32',
  mcu: '@typecad/mcu-esp32',
  board: '@typecad/board-esp32-devkit',
  framework: '@typecad/framework-arduino',
  display: { profile: 'ili9341-spi' },
};
export default config;
`;

describe("preview css @import expansion", () => {
  it("resolves tokens from a stylesheet @imported by the .ui <style>", async () => {
    const { configDir } = writeProject("with-import", {
      "cuttlefish.config.ts": CONFIG,
      "src/styles/kit.css": `
        :root { --card: #123456; }
        .card { background: var(--card); border: 1px solid var(--card); }
      `,
      "src/app.ui": `
<script>
  export function noop() {}
</script>
<style>
@import "./styles/kit.css";
</style>
<screen id="home">
  <body>
    <view id="card1" class="card"><text id="t1">hi</text></view>
  </body>
</screen>
`,
    });
    const config = parseConfigFile(path.join(configDir, "cuttlefish.config.ts"));
    expect(config).toBeTruthy();
    // Before the fix this threw: Unsupported color format "var(--card)".
    const snapshot = await buildPreviewSnapshot({ config: config!, projectRoot: configDir });
    const card = snapshot.program.nodes.find((n) => n.id === "card1");
    // The ILI9341 profile stores rgb565: #123456 -> (2<<11)|(13<<5)|10 = 0x11aa.
    expect(card?.bg).toBe(0x11aa);
  });

  it("warns when an interactive node has no id (preview wires by id)", async () => {
    const { configDir } = writeProject("idless-interactive", {
      "cuttlefish.config.ts": CONFIG,
      "src/app.ui": `
<script>
  export function countTap() {}
</script>
<style></style>
<screen id="home">
  <body>
    <button on:click={countTap}>tap</button>
    <button id="named" on:click={countTap}>named</button>
  </body>
</screen>
`,
    });
    const config = parseConfigFile(path.join(configDir, "cuttlefish.config.ts"));
    const snapshot = await buildPreviewSnapshot({ config: config!, projectRoot: configDir });
    const warnings = snapshot.diagnostics.filter((d) => d.severity === "warning");
    expect(warnings.some((d) => d.message.includes("<button> uses on:click") && d.message.includes("no id"))).toBe(true);
    // The named sibling is wired and not flagged.
    expect(warnings.some((d) => d.message.includes("named"))).toBe(false);
    expect(snapshot.callbacks.some((c) => c.nodeId === "named")).toBe(true);
  });

  it("injects the bundled default font so text renders antialiased (device parity)", async () => {
    const { configDir } = writeProject("default-font", {
      "cuttlefish.config.ts": CONFIG,
      "src/app.ui": `
<script></script>
<style></style>
<screen id="home">
  <body>
    <text id="t1">hello</text>
  </body>
</screen>
`,
    });
    const config = parseConfigFile(path.join(configDir, "cuttlefish.config.ts"));
    const snapshot = await buildPreviewSnapshot({ config: config!, projectRoot: configDir });
    // The CLI build injects the bundled DejaVu faces (ui-registry.ts /
    // transpile-ui.ts); the preview used to skip the injection, so the UA
    // root's font-family resolved to no face and every node fell back to the
    // classic 5x7 (fontFace 0).
    expect(snapshot.program.fontAssets.length).toBeGreaterThan(0);
    expect(snapshot.program.fontAssets.some((a) => a.family === "DejaVu Sans")).toBe(true);
    const text = snapshot.program.nodes.find((n) => n.id === "t1");
    expect(text?.fontFace).toBeGreaterThan(0);
  });
});
