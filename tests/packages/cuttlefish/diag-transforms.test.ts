import path from "node:path";
import { describe, it } from "vitest";
import { parseConfigFile } from "../../../packages/cuttlefish/src/config-loader";
import { buildPreviewSnapshot } from "../../../packages/cuttlefish/src/preview/build-program";
import { PreviewUIRuntime } from "../../../packages/cuttlefish/src/preview/host-ui-runtime";

describe("diag transforms render", () => {
  it("renders transforms screen and inspects scroll bottom", async () => {
    const configPath = path.resolve("demo-ui/cuttlefish.config.ts");
    const config = parseConfigFile(configPath)!;
    const snapshot = await buildPreviewSnapshot({ config, projectRoot: path.dirname(configPath) });
    const nodes = snapshot.program.nodes;
    const W = snapshot.program.width;
    const H = snapshot.program.height;

    const transformsScreenId = nodes.find((n) => n.id === "transformDemo")!.screenId;
    const body = nodes.find((n) => n.id === "transformDemo")!.parentIndex!;
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
      // force the node scrollY to max via the internal ref to confirm reachability of content
      const liveScroll = (runtime as any).nodes[scrollIdx];
      console.log(`live scroll node screenId=${liveScroll.screenId} activeScreen=${(runtime as any).activeScreen} visible=${liveScroll.visible} scrollable=${liveScroll.scrollable} contentHeight=${liveScroll.contentHeight} box.h=${liveScroll.box.h}`);

      const rotateTrackNode = nodes.find((n) => n.id === "rotateTrack")!;
      console.log(`rotateTrack layout y=${rotateTrackNode.box.y} h=${rotateTrackNode.box.h}`);

      // Simulate max scroll via the public-ish pointer API by directly setting scrollY through a drag.
      // Easiest: drive scroll through pointerDown/Move which is public.
      // Body box: x=10,y=62,w=300,h=168 -> center
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
      // drag up by 200px to force scroll to bottom
      runtime.pointerMove(cx, cy - 200);
      console.log(`  after pointerMove: isDragging=${(runtime as any).isDragging} scrollNode=${(runtime as any).scrollNode} scrollY=${(runtime as any).nodes[scrollIdx].scrollY}`);
      runtime.tick(16);
      console.log(`after drag, scrollY=${(runtime as any).nodes[scrollIdx].scrollY}`);
      runtime.pointerUp();

      // Now check pixels in the rotate track area. At scrollY=56, rotateTrack y=258 -> drawY=258-56=202.
      // The fill (#000000 destructive in neobrutalism) sits inside track.
      const px = (x: number, y: number) => runtime.gfx.buffer[y * W + x];
      function rgb565str(v: number) {
        const r = (v >> 11) & 0x1f; const g = (v >> 5) & 0x3f; const b = v & 0x1f;
        return `#${((r << 3) | (r >> 2)).toString(16).padStart(2, "0")}${((g << 2) | (g >> 4)).toString(16).padStart(2, "0")}${((b << 3) | (b >> 2)).toString(16).padStart(2, "0")}`;
      }
      // sample a vertical strip through the rotate track column at x=122 (inside track x=116..204)
      console.log("\nVertical strip at x=122 (inside rotateTrack), y=195..230:");
      for (let y = 195; y <= 230; y++) {
        const col = px(122, y);
        const drawY = rotateTrackNode.box.y - nodes[scrollIdx].scrollY;
        const trackTop = drawY;
        const trackBot = drawY + rotateTrackNode.box.h;
        const marker = (y >= trackTop && y < trackBot) ? "  [in-track]" : "";
        console.log(`  y=${y}: ${rgb565str(col)}${marker}`);
      }
    } finally {
      runtime.stop();
    }
  });
});
