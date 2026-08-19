// Automatic image conversion: <img src="*.png|*.jpg|*.ico|…"> decodes to the
// RGB565 asset form via the warm-up cache. Covers format detection, decode
// fidelity, natural-size layout propagation, ICO multi-frame selection, the
// display-fit downscale, and the legacy raw .img fallback.
//
// Fixtures are generated in a temp dir at run time (sharp is a dependency of
// @typecad/ui, so tests can build exact pixel inputs).

import { describe, expect, test, beforeEach, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import {
  detectImageFormat,
  warmUpImageDecoding,
  getCachedDecodedImage,
  resetImageDecodeCache,
} from "@typecad/ui/ui-engine/image-decode";
import { loadImageAssets, applyDecodedImageSizes } from "@typecad/ui/ui-engine/image-assets";
import type { StyledNode } from "@typecad/ui/ui-engine/style-resolver";

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "cuttlefish-img-"));
  resetImageDecodeCache();
});

/** A 6×4 image with one known pixel per corner: red TL, green TR, blue BL,
 *  white BR (interior black). Exact RGB values survive PNG losslessly. */
const W = 6;
const H = 4;
function rgbaFixture(): Buffer {
  const px = Buffer.alloc(W * H * 4);
  const set = (x: number, y: number, r: number, g: number, b: number) => {
    const i = (y * W + x) * 4;
    px[i] = r; px[i + 1] = g; px[i + 2] = b; px[i + 3] = 255;
  };
  set(0, 0, 255, 0, 0);
  set(W - 1, 0, 0, 255, 0);
  set(0, H - 1, 0, 0, 255);
  set(W - 1, H - 1, 255, 255, 255);
  return px;
}

function imgNode(src: string, id: string, withDims?: { w: number; h: number }): StyledNode {
  return {
    tag: "img",
    id,
    classes: [],
    style: {},
    children: [],
    src,
    ...(withDims ? { imgWidth: withDims.w, imgHeight: withDims.h } : {}),
  } as unknown as StyledNode;
}

function expect565(actual: number | undefined, r: number, g: number, b: number): void {
  const want = ((r >> 3) << 11) | ((g >> 2) << 5) | (b >> 3);
  expect(actual).toBe(want);
}

describe("image format detection", () => {
  test("png / jpeg / ico / svg magic bytes", async () => {
    const png = await sharp(rgbaFixture(), { raw: { width: W, height: H, channels: 4 } }).png().toBuffer();
    const jpg = await sharp(png).jpeg().toBuffer();
    expect(detectImageFormat(png)).toBe("png");
    expect(detectImageFormat(jpg)).toBe("jpeg");
    expect(detectImageFormat(Buffer.from([0x00, 0x00, 0x01, 0x00, 0x01, 0x00]))).toBe("ico");
    expect(detectImageFormat(Buffer.from(`  <svg xmlns="a"></svg>`))).toBe("svg");
    expect(detectImageFormat(Buffer.from([0xde, 0xad, 0xbe, 0xef]))).toBeNull();
  });
});

describe("warmUpImageDecoding + asset loading", () => {
  test("png decodes with natural size and exact corner pixels", async () => {
    const px = rgbaFixture();
    const png = await sharp(px, { raw: { width: W, height: H, channels: 4 } }).png().toBuffer();
    fs.writeFileSync(path.join(dir, "a.png"), png);
    await warmUpImageDecoding(`<img src="a.png">`, dir);
    const decoded = getCachedDecodedImage(path.join(dir, "a.png"));
    expect(decoded).toBeDefined();
    expect(decoded!.width).toBe(W);
    expect(decoded!.height).toBe(H);
    expect565(decoded!.data[0], 255, 0, 0);
    expect565(decoded!.data[W - 1], 0, 255, 0);
    expect565(decoded!.data[(H - 1) * W], 0, 0, 255);
    expect565(decoded!.data[H * W - 1], 255, 255, 255);
  });

  test("jpeg decodes (chroma-subsampled: only check dimensions + dominance)", async () => {
    // Solid red: single-pixel colors smear under 4:2:0 chroma subsampling,
    // so the dominance check needs a uniform field, not a corner pixel.
    const png = await sharp({ create: { width: W, height: H, channels: 3, background: "#ff0000" } }).png().toBuffer();
    const jpg = await sharp(png).jpeg({ quality: 90 }).toBuffer();
    fs.writeFileSync(path.join(dir, "a.jpg"), jpg);
    await warmUpImageDecoding(`<img src="a.jpg">`, dir);
    const decoded = getCachedDecodedImage(path.join(dir, "a.jpg"));
    expect(decoded).toBeDefined();
    expect(decoded!.width).toBe(W);
    expect(decoded!.height).toBe(H);
    // Red-dominant pixel stays red-dominant after 565 quantization.
    const r5 = (decoded!.data[0] >> 11) & 0x1f;
    const g5 = (decoded!.data[0] >> 5) & 0x3f;
    const b5 = decoded!.data[0] & 0x1f;
    expect(r5).toBeGreaterThan(g5 + 4);
    expect(r5).toBeGreaterThan(b5 + 4);
  });

  test("ico picks the largest frame", async () => {
    const big = await sharp(rgbaFixture(), { raw: { width: W, height: H, channels: 4 } })
      .resize(32, 32, { fit: "fill" }).png().toBuffer();
    const small = await sharp({ create: { width: 16, height: 16, channels: 4, background: "#00ff00" } }).png().toBuffer();
    // ICO container: header (0,0,1,0,count=2) + two dir entries + two PNG payloads.
    const header = Buffer.alloc(6);
    header.writeUInt16LE(0, 0); header.writeUInt16LE(1, 2); header.writeUInt16LE(2, 4);
    const off1 = 6 + 16 * 2;
    const off2 = off1 + big.length;
    const e1 = Buffer.alloc(16);
    e1[0] = 32; e1[1] = 32; e1.writeUInt16LE(1, 4); e1.writeUInt16LE(32, 6);
    e1.writeUInt32LE(big.length, 8); e1.writeUInt32LE(off1, 12);
    const e2 = Buffer.alloc(16);
    e2[0] = 16; e2[1] = 16; e2.writeUInt16LE(1, 4); e2.writeUInt16LE(32, 6);
    e2.writeUInt32LE(small.length, 8); e2.writeUInt32LE(off2, 12);
    fs.writeFileSync(path.join(dir, "a.ico"), Buffer.concat([header, e1, e2, big, small]));
    await warmUpImageDecoding(`<img src="a.ico">`, dir);
    const decoded = getCachedDecodedImage(path.join(dir, "a.ico"));
    expect(decoded).toBeDefined();
    expect(decoded!.width).toBe(32);
    expect(decoded!.height).toBe(32);
  });

  test("oversized images downscale to fit the display", async () => {
    const big = await sharp({ create: { width: 640, height: 480, channels: 3, background: "#808080" } }).png().toBuffer();
    fs.writeFileSync(path.join(dir, "big.png"), big);
    await warmUpImageDecoding(`<img src="big.png">`, dir, { maxW: 480, maxH: 320 });
    const decoded = getCachedDecodedImage(path.join(dir, "big.png"));
    expect(decoded).toBeDefined();
    expect(decoded!.width).toBeLessThanOrEqual(480);
    expect(decoded!.height).toBeLessThanOrEqual(320);
  });

  test("transparent png flattens alpha onto black", async () => {
    const px = Buffer.alloc(W * H * 4, 0); // fully transparent black
    const png = await sharp(px, { raw: { width: W, height: H, channels: 4 } }).png().toBuffer();
    fs.writeFileSync(path.join(dir, "t.png"), png);
    await warmUpImageDecoding(`<img src="t.png">`, dir);
    const decoded = getCachedDecodedImage(path.join(dir, "t.png"));
    expect(decoded).toBeDefined();
    expect(decoded!.data.every((v) => v === 0)).toBe(true);
  });

  test("missing files and raw dumps are left for the legacy reader", async () => {
    await warmUpImageDecoding(`<img src="missing.png"><img src="legacy.img">`, dir);
    expect(getCachedDecodedImage(path.join(dir, "missing.png"))).toBeUndefined();
    expect(getCachedDecodedImage(path.join(dir, "legacy.img"))).toBeUndefined();
  });

  test("failed decodes memoize per mtime — one warning per file state", async () => {
    // PNG magic bytes followed by garbage: detected as PNG, undecodable.
    // The failure must be cached under the file's real mtime so a second
    // warm-up of the unchanged file skips the retry (and the repeat warning).
    const corrupt = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      Buffer.alloc(32, 0),
    ]);
    fs.writeFileSync(path.join(dir, "bad.png"), corrupt);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      await warmUpImageDecoding(`<img src="bad.png">`, dir);
      await warmUpImageDecoding(`<img src="bad.png">`, dir);
      expect(warn).toHaveBeenCalledTimes(1);
    } finally {
      warn.mockRestore();
    }
  });

  test("EXIF-oriented jpegs compare the swapped natural size against the cap", async () => {
    // Stored 8×4 with EXIF orientation 6 (90° CW): the pipeline's rotate()
    // emits 4×8. The fit decision must use the post-rotation size — against
    // the stored 8×4 it would wrongly downscale to 4×2 inside a 4×8 cap.
    const px = Buffer.alloc(8 * 4 * 3, 0x80);
    const jpg = await sharp(px, { raw: { width: 8, height: 4, channels: 3 } })
      .jpeg().withMetadata({ orientation: 6 }).toBuffer();
    fs.writeFileSync(path.join(dir, "r.jpg"), jpg);
    await warmUpImageDecoding(`<img src="r.jpg">`, dir, { maxW: 4, maxH: 8 });
    const decoded = getCachedDecodedImage(path.join(dir, "r.jpg"));
    expect(decoded).toBeDefined();
    expect(decoded!.width).toBe(4);
    expect(decoded!.height).toBe(8);
  });
});

describe("asset pipeline integration", () => {
  test("converted asset flows through loadImageAssets at natural size", async () => {
    const png = await sharp(rgbaFixture(), { raw: { width: W, height: H, channels: 4 } }).png().toBuffer();
    fs.writeFileSync(path.join(dir, "a.png"), png);
    await warmUpImageDecoding(`<img id="pic" src="a.png">`, dir);

    const root: StyledNode = { tag: "view", classes: [], style: {}, children: [imgNode("a.png", "pic")] } as unknown as StyledNode;
    // No explicit width/height attrs: natural size lands before layout.
    applyDecodedImageSizes(root, dir);
    expect((root.children[0] as any).imgWidth).toBe(W);
    expect((root.children[0] as any).imgHeight).toBe(H);

    const { assets, nodeIdToAssetIndex } = loadImageAssets(root, dir);
    expect(nodeIdToAssetIndex.get("pic")).toBe(0);
    expect(assets[0].width).toBe(W);
    expect(assets[0].height).toBe(H);
    expect(assets[0].data.length).toBe(W * H);
  });

  test("raw .img files keep the legacy byte path", async () => {
    // 2×2 raw RGB565LE: red, green / blue, white.
    const raw = Buffer.alloc(4 * 2);
    const put = (i: number, v: number) => { raw.writeUInt16LE(v, i * 2); };
    put(0, 0xf800); put(1, 0x07e0); put(2, 0x001f); put(3, 0xffff);
    fs.writeFileSync(path.join(dir, "legacy.img"), raw);
    await warmUpImageDecoding(`<img id="raw" src="legacy.img" width="2" height="2">`, dir);

    const root: StyledNode = { tag: "view", classes: [], style: {}, children: [imgNode("legacy.img", "raw", { w: 2, h: 2 })] } as unknown as StyledNode;
    const { assets, nodeIdToAssetIndex } = loadImageAssets(root, dir);
    expect(nodeIdToAssetIndex.get("raw")).toBe(0);
    expect(assets[0].data).toEqual([0xf800, 0x07e0, 0x001f, 0xffff]);
  });
});
