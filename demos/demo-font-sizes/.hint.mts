import fs from "node:fs";
import opentype from "opentype.js";
const bytes = fs.readFileSync("C:/typecad/hal/packages/ui/assets/fonts/dejavu/DejaVuSans.ttf");
const font = opentype.parse(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
console.log("font.hinting available:", !!font.hinting);

function raster(path: any, bb: any): string[] {
  const x0 = Math.floor(bb.x1) - 1, y0 = Math.floor(bb.y1) - 1;
  const w = Math.ceil(bb.x2) - x0 + 1, h = Math.ceil(bb.y2) - y0 + 1;
  const S = 4;
  const cs = path.commands as { x?: number; y?: number; x1?: number; y1?: number; x2?: number; y2?: number; type: string }[];
  // Build contours from commands (same flatten as engine)
  const contours: { x: number; y: number }[][] = [];
  let cur: { x: number; y: number }[] = [];
  let start: { x: number; y: number } | null = null;
  for (const cmd of cs) {
    if (cmd.type === "M") { if (cur.length > 1) contours.push(cur); cur = [{ x: cmd.x!, y: cmd.y! }]; start = cur[0]!; }
    else if (cmd.type === "L") cur.push({ x: cmd.x!, y: cmd.y! });
    else if (cmd.type === "C" || cmd.type === "Q") {
      const p0 = cur[cur.length - 1]!;
      // hinted commands may appear as L already; handle curves generically
      const steps = cmd.type === "C" ? 12 : 8;
      for (let i = 1; i <= steps; i++) {
        const t = i / steps, m = 1 - t;
        if (cmd.type === "Q") cur.push({ x: m*m*p0.x + 2*m*t*cmd.x1! + t*t*cmd.x!, y: m*m*p0.y + 2*m*t*cmd.y1! + t*t*cmd.y! });
        else cur.push({ x: m**3*p0.x + 3*m*m*t*cmd.x1! + 3*m*t*t*cmd.x2! + t**3*cmd.x!, y: m**3*p0.y + 3*m*m*t*cmd.y1! + 3*m*t*t*cmd.y2! + t**3*cmd.y! });
      }
    } else if (cmd.type === "Z") { if (start) cur.push(start); if (cur.length > 1) contours.push(cur); cur = []; }
  }
  if (cur.length > 1) contours.push(cur);
  const inside = (px: number, py: number): boolean => {
    let pin = false;
    for (const c of contours) for (let i = 0, j = c.length - 1; i < c.length; j = i++) {
      const a = c[i]!, b = c[j]!;
      if ((a.y > py) !== (b.y > py) && px < ((b.x - a.x) * (py - a.y)) / (b.y - a.y) + a.x) pin = !pin;
    }
    return pin;
  };
  const rows: string[] = [];
  for (let py = 0; py < h; py++) {
    let row = "";
    for (let px = 0; px < w; px++) {
      let cov = 0;
      for (let sy = 0; sy < S; sy++) for (let sx = 0; sx < S; sx++) if (inside(x0 + px + (sx + 0.5) / S, y0 + py + (sy + 0.5) / S)) cov++;
      row += Math.round((cov * 15) / (S * S)) >= 4 ? "#" : ".";
    }
    rows.push(row);
  }
  return rows;
}

for (const px of [10, 12]) {
  for (const ch of ["g", "%", "R"]) {
    const glyph = font.charToGlyph(ch);
    const plain = glyph.getPath(0, 0, px);
    const hinted = glyph.getPath(0, 0, px, { hinting: true }, font);
    const rp = raster(plain, plain.getBoundingBox());
    const rh = raster(hinted, hinted.getBoundingBox());
    const h = Math.max(rp.length, rh.length);
    console.log(`===== '${ch}' @${px}px  plain | TT-hinted`);
    for (let y = 0; y < h; y++) console.log((rp[y] ?? "").padEnd(12) + " " + (rh[y] ?? ""));
  }
}
process.exit(0);
