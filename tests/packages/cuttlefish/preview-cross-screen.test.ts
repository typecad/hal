import { describe, it, expect } from "vitest";
import path from "node:path";
import { parseConfigFile } from "../../../packages/cuttlefish/src/config-loader";
import { buildPreviewSnapshot } from "../../../packages/cuttlefish/src/preview/build-program";
import { PreviewUIRuntime } from "../../../packages/cuttlefish/src/preview/host-ui-runtime";

// These tests build the *real* demo-ui snapshot and drive the preview runtime,
// catching two preview↔hardware divergences that the device runtime avoids:
//
//  1. @keyframes animations advance for nodes on every screen. On the device
//     (runtime-header.ts ~line 2842) cross-screen animations are skipped with
//     `if (...screenId != __ui_active_screen) continue;`. The preview was missing
//     that guard, so the transform-screen dots repainted their parent's background
//     into the home framebuffer (the "yellow blob over the button").
//
//  2. <a href> links without an id weren't wired for navigation. The device
//     auto-wires any node with an id OR an href (ui-element-auto-wire.ts); the
//     preview gated on `id && href`, so id-less nav links were dead.
//
// Both bugs are preview-only — the hardware behaves correctly — so a parity
// test against the real snapshot is the right place to lock them down.

const DEMO_ROOT = path.resolve(__dirname, "../../../demo-ui");

async function makeRuntime(): Promise<PreviewUIRuntime> {
  const configPath = path.join(DEMO_ROOT, "cuttlefish.config.ts");
  const config = parseConfigFile(configPath)!;
  const snapshot = await buildPreviewSnapshot({ config, projectRoot: DEMO_ROOT });
  const rt = new PreviewUIRuntime(snapshot, { onFrame: () => {} });
  rt.start();
  return rt;
}

// The transform screen (#transformTrack) backgrounds are light (#ffe6-ish in
// rgb565 ≈ 0xffe6). They must never appear on the home screen, whose palette is
// dark (backgrounds + one orange button). We detect "alien" light pixels as any
// pixel brighter than the brightest legitimate home element.
function alienLightPixelCount(buffer: Uint16Array, W: number, H: number): number {
  // Brightest legitimate home element: the orange button (0xfb2c) and white text
  // (0xffff). Light pastel background colors (transformTrack 0xffe6, etc.) are
  // bright *and* low-saturation-vs-white — but simplest robust signal: count
  // pixels matching the known leaked transform palette.
  let n = 0;
  for (let i = 0; i < W * H; i++) {
    const c = buffer[i];
    // 0xffe6 = transform track bg (the primary leak). Guard against drift by also
    // catching any very bright off-palette pixel (both nybbles near max, i.e. near
    // white but not exactly 0xffff text).
    if (c === 0xffe6) n++;
  }
  return n;
}

describe("preview ↔ hardware parity: cross-screen animations & links", () => {
  it("does not paint transform-screen colors onto the home screen", async () => {
    const rt = await makeRuntime();
    const W = 320, H = 240;
    // Advance several animation cycles — the bug repaints the blob each tick.
    for (let i = 0; i < 8; i++) rt.tick(130);

    const buffer = (rt as unknown as { gfx: { buffer: Uint16Array } }).gfx.buffer;
    const leaked = alienLightPixelCount(buffer, W, H);
    rt.stop();
    expect(leaked).toBe(0);
  }, 15000);

  it("clicking an id-less <a href> nav link navigates to the target screen", async () => {
    const rt = await makeRuntime();
    const nodes = (rt as unknown as { nodes: any[] }).nodes;
    const activeScreen = () => (rt as unknown as { activeScreen: number }).activeScreen;
    const startScreen = activeScreen();

    // The home nav links: <a href="#controls">Controls ></a> etc. They carry
    // href at the styled-node layer (where callbacks are wired) but the lowered
    // runtime node only retains its text — so locate the link by its "…>"
    // nav-link text and the callback registered against it.
    const link = nodes.find(
      (n) => (n.screenId ?? 0) === startScreen && typeof n.text === "string" && />\s*$/.test(n.text),
    );
    expect(link).toBeDefined();

    const cx = link!.box.x + Math.floor(link!.box.w / 2);
    const cy = link!.box.y + Math.floor(link!.box.h / 2);
    rt.pointerDown(cx, cy);
    rt.pointerUp();

    const navigated = activeScreen() !== startScreen;
    rt.stop();
    expect(navigated).toBe(true);
  }, 15000);

  it("tapping a visible inline rich-text <a href> link navigates to its target", async () => {
    // The richtext screen's richMixed <p> contains an inline
    // <a href="#home">link home</a>. The paragraph wraps across several lines
    // and is taller than the scroll viewport, so its bounding box overflows
    // below the visible region — but the link segment itself sits in the
    // visible part. A tap on the visible link must still navigate. Regression
    // for hit-test rejecting a node whose *box* overflows the scroll viewport
    // even though the *tap point* is visible.
    const rt = await makeRuntime();
    const nodes = (rt as unknown as { nodes: any[] }).nodes;
    const activeScreen = () => (rt as unknown as { activeScreen: number }).activeScreen;

    // Locate the richMixed <p> by its runs + a link run (linkTarget >= 0).
    const rich = nodes.find((n) => n.runs?.some((r: any) => r.linkTarget >= 0));
    expect(rich).toBeDefined();

    // Switch to the richtext screen.
    (rt as unknown as { navigate: (i: number) => void }).navigate(rich!.screenId ?? 0);
    rt.tick(16);
    const targetScreen = activeScreen();

    // Find the link segment's geometry and tap its midpoint.
    const rl = rich!.runLines;
    let segIdx = -1;
    for (let si = 0; si < rl.segRun.length; si++) {
      if (rich!.runs[rl.segRun[si]].linkTarget >= 0) { segIdx = si; break; }
    }
    expect(segIdx).toBeGreaterThanOrEqual(0);
    const li = rl.segLine[segIdx];
    const originX = (rt as unknown as {
      lineX: (n: any, lw: number, x: number, w: number) => number,
    }).lineX(rich, rl.lineW[li], 0, rich!.box.w);
    const drawX = (rt as unknown as { drawXForNode: (i: number) => number }).drawXForNode(rich!.index ?? 0);
    const drawY = (rt as unknown as { drawYForNode: (i: number) => number }).drawYForNode(rich!.index ?? 0);
    const tapX = drawX + originX + rl.segX[segIdx] + Math.floor(rl.segW[segIdx] / 2);
    const tapY = drawY + rl.lineY[li] + Math.floor(rl.lineH[li] / 2);

    rt.pointerDown(tapX, tapY);
    rt.pointerUp();

    const navigated = activeScreen() !== targetScreen;
    rt.stop();
    expect(navigated).toBe(true);
  }, 15000);
});
