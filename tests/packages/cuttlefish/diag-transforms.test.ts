import path from "node:path";
import { describe, it } from "vitest";
import { parseConfigFile } from "../../../packages/cuttlefish/src/config-loader";
import { buildPreviewSnapshot } from "../../../packages/cuttlefish/src/preview/build-program";
import { PreviewUIRuntime } from "../../../packages/cuttlefish/src/preview/host-ui-runtime";

// Diagnostic helper: drives the Transforms screen scroll through both the
// internal applyScrollDelta API and the public pointer-drag path, then logs a
// vertical pixel strip through the rotate track for human inspection. This is
// NOT an assertion test — no expect() calls; it exists to eyeball scroll reach
// and rotate-track rendering.
//
// Retargeted from the removed #rotateTrack node to the surviving #dotRotate
// dot inside the rotate track, and to the scrollable ancestor of #transformDemo.

describe("diag transforms render", () => {
  it("renders transforms screen and inspects scroll bottom", async () => {
    const configPath = path.resolve("demo-ui/cuttlefish.config.ts");
    const config = parseConfigFile(configPath)!;
    const snapshot = await buildPreviewSnapshot({ config, projectRoot: path.dirname(configPath) });
    const nodes = snapshot.program.nodes;
    const W = snapshot.program.width;

    const transformsScreenId = nodes.find((n) => n.id === "transformDemo")!.screenId;
    // find the scrollable body ancestor
    let scrollIdx = -1;
    for (let i = 0; i < nodes.length; i++) {
      if (nodes[i].scrollable && nodes[i].screenId === transformsScreenId) { scrollIdx = i; break; }
    }
    const scrollNode = nodes[scrollIdx];
    console.log(`Scroll body [${scrollIdx}] box={y:${scrollNode.box.y}, h:${scrollNode.box.h}} contentHeight=${scrollNode.contentHeight} maxScroll=${scrollNode.contentHeight - scrollNode.box.h}`);

    const runtime = new PreviewUIRuntime(snapshot);
    runtime.start();
    try {
      // Navigate to transforms screen
      runtime.navigate(transformsScreenId);
      runtime.tick(16);
      const liveScroll = (runtime as any).nodes[scrollIdx];
      console.log(`live scroll node screenId=${liveScroll.screenId} activeScreen=${(runtime as any).activeScreen} visible=${liveScroll.visible} scrollable=${liveScroll.scrollable} contentHeight=${liveScroll.contentHeight} box.h=${liveScroll.box.h}`);

      const rotateDotNode = nodes.find((n) => n.id === "dotRotate")!;
      console.log(`dotRotate layout y=${rotateDotNode.box.y} h=${rotateDotNode.box.h} x=${rotateDotNode.box.x} w=${rotateDotNode.box.w}`);

      // Simulate max scroll via the public-ish pointer API by directly setting scrollY through a drag.
      const cx = Math.round(scrollNode.box.x + scrollNode.box.w / 2);
      const cy = Math.round(scrollNode.box.y + scrollNode.box.h / 2);
      console.log(`drag start at (${cx},${cy})`);

      // Test A: directly drive scroll delta via internal API
      const scrolled = (runtime as any).applyScrollDelta(scrollIdx, -56);
      console.log(`applyScrollDelta(-56) -> ${scrolled}, scrollY=${(runtime as any).nodes[scrollIdx].scrollY}`);
      runtime.tick(16);
      console.log(`after tick, scrollY=${(runtime as any).nodes[scrollIdx].scrollY}`);
      // Reset
      (runtime as any).applyScrollDelta(scrollIdx, 56);
      runtime.tick(16);

      // Test B: public drag path
      runtime.pointerDown(cx, cy);
      console.log(`  after pointerDown: scrollNode=${(runtime as any).scrollNode} scrollStartY=${(runtime as any).scrollStartY}`);
      // drag up to force scroll toward the bottom (where the rotate track lives)
      runtime.pointerMove(cx, cy - 200);
      console.log(`  after pointerMove: isDragging=${(runtime as any).isDragging} scrollNode=${(runtime as any).scrollNode} scrollY=${(runtime as any).nodes[scrollIdx].scrollY}`);
      runtime.tick(16);
      console.log(`after drag, scrollY=${(runtime as any).nodes[scrollIdx].scrollY}`);
      runtime.pointerUp();

      // Sample a vertical strip through the rotate dot column. The dot sits at
      // dotRotate.box.x..x+w; sample its center column and mark rows inside the
      // dot's drawn rect (box.y - scrollY).
      const stripX = Math.round(rotateDotNode.box.x + rotateDotNode.box.w / 2);
      const sy = (runtime as any).nodes[scrollIdx].scrollY;
      const drawY = rotateDotNode.box.y - sy;
      const px = (x: number, y: number) => runtime.gfx.buffer[y * W + x];
      function rgb565str(v: number) {
        const r = (v >> 11) & 0x1f; const g = (v >> 5) & 0x3f; const b = v & 0x1f;
        return `#${((r << 3) | (r >> 2)).toString(16).padStart(2, "0")}${((g << 2) | (g >> 4)).toString(16).padStart(2, "0")}${((b << 3) | (b >> 2)).toString(16).padStart(2, "0")}`;
      }
      const stripStart = Math.max(0, Math.floor(drawY) - 6);
      const stripEnd = Math.min(snapshot.program.height, Math.ceil(drawY + rotateDotNode.box.h + 6));
      console.log(`\nVertical strip at x=${stripX} (through dotRotate center), y=${stripStart}..${stripEnd}:`);
      for (let y = stripStart; y <= stripEnd; y++) {
        const col = px(stripX, y);
        const dotTop = drawY;
        const dotBot = drawY + rotateDotNode.box.h;
        const marker = (y >= dotTop && y < dotBot) ? "  [in-dot]" : "";
        console.log(`  y=${y}: ${rgb565str(col)}${marker}`);
      }
    } finally {
      runtime.stop();
    }
  });
});
