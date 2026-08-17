// The preview's stock-font fallback: without a vendored Adafruit_GFX library
// the preview runtime must still get real glcdfont bytes (bundled in
// @typecad/cuttlefish), not a blank table + warning.
import { describe, expect, it, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadFont } from "@typecad/ui/preview/build-program";

let tmp: string;

beforeAll(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cf-glcdfont-"));
});

afterAll(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe("preview stock font loading", () => {
  it("falls back to the bundled glcdfont without a warning", () => {
    const diags: unknown[] = [];
    const bytes = loadFont(tmp, diags as never);
    expect(bytes).toHaveLength(1280);
    expect(bytes.some((b) => b !== 0)).toBe(true);
    expect(diags).toEqual([]);
  });

  it("prefers the project-local Adafruit_GFX copy when present", () => {
    const libDir = path.join(tmp, "proj-with-lib", "lib", "Adafruit_GFX_Library");
    fs.mkdirSync(libDir, { recursive: true });
    // A doctored font: first byte distinguishable, rest zeros. Short of 1280
    // to also prove the length warning still fires for real project copies.
    fs.writeFileSync(
      path.join(libDir, "glcdfont.c"),
      "static const unsigned char font[] PROGMEM = { 0xAB, 0xCD };\n",
    );
    const diags: Array<{ severity: string; message: string }> = [];
    const bytes = loadFont(path.join(tmp, "proj-with-lib"), diags);
    expect(bytes[0]).toBe(0xab);
    expect(bytes).toHaveLength(2);
    expect(diags.some((d) => d.message.includes("expected 1280"))).toBe(true);
  });
});
