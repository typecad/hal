import { writeFileSync, mkdirSync } from "node:fs";
import zlib from "node:zlib";
import path from "node:path";
import { describe, it } from "vitest";
import { parseConfigFile } from "../../../packages/cuttlefish/src/config-loader";
import { buildPreviewSnapshot } from "../../../packages/cuttlefish/src/preview/build-program";
import { PreviewUIRuntime } from "../../../packages/cuttlefish/src/preview/host-ui-runtime";

function crc32(buf: Uint8Array): number {
  let c: number;
  const table: number[] = [];
  for (let n = 0; n < 256; n++) {
    c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) crc = table[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function writePng(file: string, rgba: Uint8Array, width: number, height: number, scale = 1): void {
  const w = width * scale;
  const h = height * scale;
  // Build raw image data with filter byte per scanline
  const scaled = new Uint8Array(w * h * 4 + h);
  let o = 0;
  for (let y = 0; y < height; y++) {
    for (let s = 0; s < scale; s++) {
      scaled[o++] = 0; // filter none
      for (let x = 0; x < width; x++) {
        const src = (y * width + x) * 4;
        for (let t = 0; t < scale; t++) {
          scaled[o++] = rgba[src];
          scaled[o++] = rgba[src + 1];
          scaled[o++] = rgba[src + 2];
          scaled[o++] = rgba[src + 3];
        }
      }
    }
  }
  const compressed = zlib.deflateSync(scaled);
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  function chunk(type: string, data: Buffer): Buffer {
    const typeBuf = Buffer.from(type, "ascii");
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length, 0);
    const crcInput = Buffer.concat([typeBuf, data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(crcInput), 0);
    return Buffer.concat([len, typeBuf, data, crc]);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;

  const png = Buffer.concat([
    sig,
    chunk("IHDR", ihdr),
    chunk("IDAT", Buffer.from(compressed)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
  writeFileSync(file, png);
}

describe("diag render png", () => {
  it("renders transforms screen to png at top and bottom scroll", async () => {
    const configPath = path.resolve("demo-ui/cuttlefish.config.ts");
    const config = parseConfigFile(configPath)!;
    const snapshot = await buildPreviewSnapshot({ config, projectRoot: path.dirname(configPath) });
    const nodes = snapshot.program.nodes;
    const transformsScreenId = nodes.find((n) => n.id === "transformDemo")!.screenId;
    let scrollIdx = -1;
    for (let i = 0; i < nodes.length; i++) {
      if (nodes[i].scrollable && nodes[i].screenId === transformsScreenId) { scrollIdx = i; break; }
    }
    const scrollNode = nodes[scrollIdx];
    const maxScroll = scrollNode.contentHeight - scrollNode.box.h;

    const outDir = path.resolve("diag-out");
    mkdirSync(outDir, { recursive: true });
    const runtime = new PreviewUIRuntime(snapshot);
    runtime.start();
    try {
      runtime.navigate(transformsScreenId);
      runtime.tick(16);
      writePng(path.join(outDir, "transforms-top.png"), runtime.gfx.toRgbaBytes(), snapshot.program.width, snapshot.program.height, 2);

      // scroll to bottom
      (runtime as any).applyScrollDelta(scrollIdx, -maxScroll);
      runtime.tick(16);
      writePng(path.join(outDir, "transforms-bottom.png"), runtime.gfx.toRgbaBytes(), snapshot.program.width, snapshot.program.height, 2);
      console.log(`maxScroll=${maxScroll}, wrote PNGs to ${outDir}`);

      // Inspect rotate track region pixels. track layout: x=116..204, y=258..286
      const W = snapshot.program.width;
      const buf = runtime.gfx.buffer as Uint16Array;
      const rotNode = nodes.find((n) => n.id === "rotateTrack")!;
      const rotLabel = nodes.find((n) => n.id === "rotateLabel")!;
      const sy = (runtime as any).nodes[scrollIdx].scrollY;
      const drawY = rotNode.box.y - sy;
      const labelDrawY = rotLabel.box.y - sy;
      console.log(`rotateTrack box.y=${rotNode.box.y} scrollY=${sy} drawY=${drawY} drawBottom=${drawY + rotNode.box.h}`);
      console.log(`rotateLabel box.y=${rotLabel.box.y} drawY=${labelDrawY} drawBottom=${labelDrawY + rotLabel.box.h}`);
      function hex565(v: number) {
        const r = (v >> 11) & 0x1f, g = (v >> 5) & 0x3f, b = v & 0x1f;
        return "#" + [r, g, b].map((c) => ((c << 3) | (c >> 2)).toString(16).padStart(2, "0")).join("");
      }
      // ASCII art of the bottom region: columns 100..210, rows labelDrawY-2 .. 239
      const startX = 100, endX = 210;
      const startY = Math.max(0, labelDrawY - 2), endY = 240;
      console.log(`\nASCII art rows ${startY}..${endY}, cols ${startX}..${endX} (W=white text, Y=yellow track, P=purple/red fill, .=black):`);
      for (let y = startY; y < endY; y++) {
        let row = `y=${String(y).padStart(3)} `;
        for (let x = startX; x < endX; x++) {
          const v = buf[y * W + x];
          const r = (v >> 11) & 0x1f, g = (v >> 5) & 0x3f, b = v & 0x1f;
          const bright = r + g + b;
          let ch = ".";
          if (bright === 0) ch = " ";            // black
          else if (g > 40 && r < 20 && b < 20) ch = "G"; // green-ish
          else if (r > 20 && g > 30 && b < 10) ch = "Y"; // yellow
          else if (r > 20 && g < 15 && b > 20) ch = "M"; // magenta/purple
          else if (r > 20 && g > 15 && b > 15 && bright > 90) ch = "W"; // white-ish text
          else ch = "#";
          row += ch;
        }
        console.log(row);
      }
    } finally {
      runtime.stop();
    }
  });
});
