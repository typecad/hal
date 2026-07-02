import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const runtimeSrc = readFileSync(
  resolve("packages/cuttlefish/src/preview/host-ui-runtime.ts"),
  "utf8",
);

const gfxSrc = readFileSync(
  resolve("packages/cuttlefish/src/preview/host-gfx.ts"),
  "utf8",
);

describe("host preview render clipping", () => {
  it("clips loop-heavy UI runtime helpers before drawing inner pixels/lines", () => {
    expect(runtimeSrc).toMatch(/activeDrawClip\(\)[\s\S]*getClipRect\(\)/);
    expect(runtimeSrc).toMatch(/drawImageWithFit[\s\S]*intersectRect\([\s\S]*activeDrawClip\(\)[\s\S]*for \(let ty = tyStart; ty < tyEnd; ty\+\+\)/);
    expect(runtimeSrc).toMatch(/drawAssetText[\s\S]*const clip = this\.activeDrawClip\(\)[\s\S]*for \(let gy = gyStart; gy < gyEnd; gy\+\+\)/);
    expect(runtimeSrc).toMatch(/drawGradientFill[\s\S]*intersectRect\(\{ x: bx, y: by, w: bw, h: bh \}, this\.activeDrawClip\(\)\)[\s\S]*for \(let y = yStart; y < yEnd; y\+\+\)/);
    expect(runtimeSrc).toMatch(/drawTextLines[\s\S]*const clip = this\.activeDrawClip\(\)[\s\S]*y \+ layout\.lineHeight <= clip\.y[\s\S]*continue/);
  });

  it("clips host antialiased text to the active clip rectangle", () => {
    expect(gfxSrc).toMatch(/drawAntialiasedText[\s\S]*const activeClip = this\.clipRect \?\?[\s\S]*const localX0 = clipX0 - destX/);
    expect(gfxSrc).toMatch(/drawAntialiasedText[\s\S]*for \(let yy = localY0; yy < localY1; yy\+\+\)[\s\S]*for \(let xx = localX0; xx < localX1; xx\+\+\)/);
  });
});
