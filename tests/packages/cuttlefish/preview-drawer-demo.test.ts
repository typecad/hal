// Definitive preview check with the REAL demo program: open the drawer,
// fire the Tap-me signal update, verify drawer content pixels survive.
import { describe, it, expect, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseConfigFile } from "@typecad/cuttlefish/config-loader";
import { buildPreviewSnapshot } from "@typecad/ui/preview/build-program";
import { PreviewUIRuntime } from "../../../packages/ui/src/preview/host-ui-runtime";
import { GLCDFONT_BYTES } from "@typecad/cuttlefish/api/shared";

const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

describe("demo-shadcn drawer overlap (real program, preview runtime)", () => {
  const runtimes: PreviewUIRuntime[] = [];
  afterAll(() => { for (const r of runtimes) r.stop(); });

  it("drawer content survives the Tap-me echo update", async () => {
    const configPath = path.resolve(__dirname, "../../../demos/demo-shadcn/cuttlefish.config.ts");
    const snap = await buildPreviewSnapshot({
      config: parseConfigFile(configPath) as never,
      projectRoot: path.dirname(configPath),
    });
    const rt: any = new PreviewUIRuntime({
      ...snap,
      font: new Uint8Array(GLCDFONT_BYTES.slice(0, 1280) as unknown as number[]),
    } as never);
    runtimes.push(rt);
    rt.start();
    // Go to the drawer screen (find its index by the drawer node's screenId).
    const drawerNode = snap.program.nodes.find((n: any) => (n as any).drawerSide === 0);
    expect(drawerNode).toBeDefined();
    rt.navigate((drawerNode as any).screenId);
    for (let i = 0; i < 4; i++) { rt.tick(33); }
    await wait(50);

    rt.drawerOpen("demoDrawer");
    for (let i = 0; i < 30; i++) { rt.tick(16); }
    await wait(50);

    const W = snap.program.width;
    const gfx = rt.gfx;
    const px = (x: number, y: number) => gfx.buffer[y * W + x];
    const drawer = rt.nodes.find((n: any) => n.id === "demoDrawer");
    const dX = rt.drawXForNode(drawer.index);
    const dY = rt.drawYForNode(drawer.index);
    // Panel painted with its bg somewhere in its interior.
    expect(px(dX + 100, dY + 80)).toBe(drawer.bg);

    // Count non-panel content pixels inside the panel before/after the tap.
    const contentPixels = (): number => {
      let n = 0;
      for (let y = dY + 2; y < dY + drawer.box.h - 2; y += 1) {
        for (let x = dX + 2; x < dX + drawer.box.w - 2; x += 1) {
          const c = px(x, y);
          if (c !== drawer.bg && c !== 0) n++;
        }
      }
      return n;
    };
    const before = contentPixels();
    expect(before).toBeGreaterThan(200); // title + description + buttons drew

    // The Tap-me click effect: drawerTaps++ → the echo behind rebinds.
    rt.runBody("drawerTaps = drawerTaps + 1");
    await wait(60);
    for (let i = 0; i < 6; i++) { rt.tick(33); }
    await wait(50);

    const after = contentPixels();
    // Content may change slightly (button press states), but must not vanish.
    expect(after).toBeGreaterThan(before * 0.5);
    expect(px(dX + 100, dY + 80)).toBe(drawer.bg);
  });
});
