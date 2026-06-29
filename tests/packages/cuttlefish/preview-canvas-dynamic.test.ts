import { describe, it, expect } from "vitest";
import path from "node:path";
import { parseConfigFile } from "../../../packages/cuttlefish/src/config-loader";
import { buildPreviewSnapshot } from "../../../packages/cuttlefish/src/preview/build-program";
import { PreviewUIRuntime } from "../../../packages/cuttlefish/src/preview/host-ui-runtime";
import { resolveColor } from "@typecad/cuttlefish/ui/color";

// The gauge needle is drawn inside a `ui.drawCanvas` body that reads dynamic
// values: `ctx.line(80, 100, screen.gauge.value, screen.gaugeTip.value, ...)`.
// The device emits these as real C++ expressions evaluated each frame
// (`__ui_nodes[72].value`). The preview's canvas-body evaluator used to
// parseInt() each argument, so `screen.gauge.value` became NaN→0 and the needle
// was frozen at x=0 regardless of the advancing angle. This locks down that the
// needle actually moves as the driving interval fires.

const DEMO_ROOT = path.resolve(__dirname, "../../../demo-ui");
const RED = resolveColor("#ff5577", "rgb565") & 0xffff;

function redPixelXRange(buffer: Uint16Array, W: number): { minX: number; maxX: number } {
  let minX = Infinity;
  let maxX = -Infinity;
  for (let i = 0; i < buffer.length; i++) {
    if (buffer[i] === RED) {
      const x = i % W;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
    }
  }
  return { minX: minX === Infinity ? -1 : minX, maxX };
}

describe("preview canvas: dynamic arguments redraw each frame", () => {
  it("the gauge needle moves as screen.gauge.value advances", async () => {
    const configPath = path.join(DEMO_ROOT, "cuttlefish.config.ts");
    const config = parseConfigFile(configPath)!;
    const snapshot = await buildPreviewSnapshot({ config, projectRoot: DEMO_ROOT });
    const rt = new PreviewUIRuntime(snapshot, { onFrame: () => {}, onDiagnostics: () => {} });
    rt.start();
    (rt as unknown as { navigate: (n: number) => void }).navigate(3); // Canvas screen
    rt.tick();

    const buffer = () => (rt as unknown as { gfx: { buffer: Uint16Array } }).gfx.buffer;
    const early = redPixelXRange(buffer(), snapshot.program.width);

    // Let the driving setInterval advance the angle several times.
    await new Promise((resolve) => setTimeout(resolve, 350));
    rt.tick();
    rt.stop();

    const late = redPixelXRange(buffer(), snapshot.program.width);

    // The needle pivots at a fixed point (canvas x=80) and its tip follows
    // gauge.value. The pivot's x stays constant, but the tip moves as the angle
    // sweeps — so the red pixels' span must change between early and late. A
    // frozen needle (the bug) keeps an identical span.
    const earlySpan = early.maxX - early.minX;
    const lateSpan = late.maxX - late.minX;
    expect(lateSpan).not.toBe(earlySpan);
  }, 15000);
});
