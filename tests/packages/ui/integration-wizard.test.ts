// ---------------------------------------------------------------------------
// @typecad/ui integration wizard — unit tests for the pure pieces.
//
// Covers the display catalog shape, the config-splice writer (insert, replace,
// CRLF, comma/comment handling), rendering (key order, hex addresses, nested
// inline objects), the starter .ui template, pin-conflict detection, and a
// round-trip through the real cuttlefish config loader so the wizard's output
// is guaranteed to parse the same way the build parses it.
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  DISPLAY_CATALOG,
  TOUCH_CATALOG,
  findPinConflicts,
  findCuttlefishConfig,
  findSyntaxError,
  readConfigSection,
  readEntryPath,
  renderDisplayBody,
  renderDisplayProperty,
  upsertDisplaySection,
  renderStarterUi,
  type ConfigRecord,
} from "@typecad/ui/wizard";

// ---------------------------------------------------------------------------
// Catalog
// ---------------------------------------------------------------------------

describe("wizard display catalog", () => {
  it("has unique ids and covers the framework's built-in profiles", () => {
    const ids = DISPLAY_CATALOG.map((entry) => entry.id);
    expect(new Set(ids).size).toBe(ids.length);
    // Mirrors BUILT_IN_PROFILES in @typecad/framework-arduino.
    for (const profile of ["ili9341-spi", "st7796-spi", "ssd1309-i2c"]) {
      expect(ids).toContain(profile);
    }
    expect(ids).toContain("sdl");
    expect(ids).toContain("custom");
  });

  it("touch catalog covers the built-in Arduino touch libraries", () => {
    const ids = TOUCH_CATALOG.map((entry) => entry.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const library of [
      "XPT2046_Touchscreen",
      "Adafruit_TouchScreen",
      "Adafruit_STMPE610",
      "FT6336U",
      "GT911",
      "CST816S",
    ]) {
      expect(ids).toContain(library);
    }
  });
});

describe("findPinConflicts", () => {
  it("flags GPIOs shared between display and touch wiring", () => {
    const conflicts = findPinConflicts(
      { cs: 5, dc: 17, rst: 22, backlight: 33 },
      { cs: 5, irq: 4 },
    );
    expect(conflicts).toEqual(["display.cs and touch.cs are both wired to GPIO 5"]);
  });

  it("reports nothing for disjoint wiring", () => {
    expect(findPinConflicts({ cs: 5, dc: 2 }, { cs: 15, irq: 17 })).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

describe("renderDisplayProperty", () => {
  it("renders key order verbatim, hex addresses, and inline nested objects", () => {
    const display: ConfigRecord = {
      profile: "st7796-spi",
      cs: 5,
      dc: 17,
      rst: 16,
      spiFrequency: 80_000_000,
      colorOrder: "bgr",
      touch: {
        library: "FT6336U",
        i2cAddress: 0x38,
        i2cFrequency: 400_000,
        calibration: { xMin: 0, xMax: 320, yMin: 0, yMax: 480 },
      },
    };
    const text = renderDisplayProperty(display);
    expect(text).toBe(
      [
        "display: {",
        "  profile: 'st7796-spi',",
        "  cs: 5,",
        "  dc: 17,",
        "  rst: 16,",
        "  spiFrequency: 80000000,",
        "  colorOrder: 'bgr',",
        "  touch: { library: 'FT6336U', i2cAddress: 0x38, i2cFrequency: 400000, calibration: { xMin: 0, xMax: 320, yMin: 0, yMax: 480 } },",
        "}",
      ].join("\n"),
    );
  });

  it("indents body lines and the closing brace relative to the given indent (the property's first line is positioned by the caller)", () => {
    const text = renderDisplayProperty({ cs: 5 }, { indent: "    " });
    expect(text).toBe('display: {\n      cs: 5,\n    }');
  });

  it("escapes single quotes in string values", () => {
    const text = renderDisplayProperty({ themeCss: "./themes/it's.css" });
    expect(text).toContain(`themeCss: './themes/it\\'s.css',`);
  });

  it("renders comments above their key and honors custom indentation", () => {
    const text = renderDisplayBody(
      { cs: 5, spiFrequency: 40_000_000 },
      { indent: "    ", comments: { spiFrequency: "Hz — lower this if the panel glitches" } },
    );
    expect(text).toBe(
      [
        "{",
        "    cs: 5,",
        "    // Hz — lower this if the panel glitches",
        "    spiFrequency: 40000000,",
        "}",
      ].join("\n"),
    );
  });
});

// ---------------------------------------------------------------------------
// Reading existing config sections
// ---------------------------------------------------------------------------

const DEMO_LIKE_CONFIG = `import type { CuttlefishConfig } from '@typecad/cuttlefish/api';

const config: CuttlefishConfig = {
  entry: './src/showcase.ui',
  target: 'esp32',
  mcu: '@typecad/mcu-esp32',
  board: '@typecad/board-esp32-devkit',
  framework: '@typecad/framework-arduino',
  frameworkData: { buildTarget: 'esp32:esp32:esp32' },
  output: { framework: 'arduino', outDir: './out' },
  toolchain: { type: 'arduino-cli' },
  display: {
    profile: 'ili9341-spi',
    cs: 5,
    dc: 21,
    rst: 22,
    backlight: 33,
    spiFrequency: 80000000,
    touch: {
      library: 'XPT2046_Touchscreen',
      cs: 15,
      irq: 17,
      calibration: { xMin: 375, xMax: 3950, yMin: 200, yMax: 3750 },
    },
  },
};

export default config;
`;

describe("readConfigSection / readEntryPath", () => {
  it("extracts the display section as a nested record", () => {
    const display = readConfigSection(DEMO_LIKE_CONFIG, "display");
    expect(display).toBeDefined();
    expect(display!.profile).toBe("ili9341-spi");
    expect(display!.cs).toBe(5);
    expect(display!.touch).toEqual({
      library: "XPT2046_Touchscreen",
      cs: 15,
      irq: 17,
      calibration: { xMin: 375, xMax: 3950, yMin: 200, yMax: 3750 },
    });
  });

  it("extracts the entry path", () => {
    expect(readEntryPath(DEMO_LIKE_CONFIG)).toBe("./src/showcase.ui");
  });

  it("returns undefined for a missing section or unrecognizable config", () => {
    expect(readConfigSection("export default {};", "display")).toBeUndefined();
    expect(readConfigSection("export default 42;", "display")).toBeUndefined();
    expect(readConfigSection("const x = 1;", "display")).toBeUndefined();
  });

  it("reads `export default { ... }` inline objects and satisfies-wrapped configs", () => {
    const inline = readConfigSection(
      "export default { display: { cs: 7 } } satisfies CuttlefishConfig;",
      "display",
    );
    expect(inline).toEqual({ cs: 7 });
    const wrapped = readConfigSection(
      "const config = { display: { cs: 9 } } as CuttlefishConfig;\nexport default config;",
      "display",
    );
    expect(wrapped).toEqual({ cs: 9 });
  });
});

// ---------------------------------------------------------------------------
// Splicing
// ---------------------------------------------------------------------------

const NEW_DISPLAY: ConfigRecord = {
  profile: "st7796-spi",
  cs: 5,
  dc: 17,
  rst: 16,
  spiFrequency: 80_000_000,
  colorOrder: "bgr",
  invertDisplay: false,
  antialias: true,
  touch: {
    library: "FT6336U",
    i2cAddress: 0x38,
    i2cFrequency: 400_000,
    irq: 15,
    calibration: { xMin: 0, xMax: 320, yMin: 0, yMax: 480 },
  },
};

describe("upsertDisplaySection", () => {
  it("replaces an existing display section and leaves the rest of the file byte-identical", () => {
    const result = upsertDisplaySection(DEMO_LIKE_CONFIG, NEW_DISPLAY);
    expect(result.mode).toBe("replaced");
    expect(findSyntaxError(result.text)).toBeNull();

    // Everything before `display:` and after its closing brace is untouched.
    const prefixEnd = result.text.indexOf("  display: {");
    expect(prefixEnd).toBeGreaterThan(0);
    expect(result.text.slice(0, prefixEnd)).toBe(DEMO_LIKE_CONFIG.slice(0, DEMO_LIKE_CONFIG.indexOf("  display: {")));

    const roundTrip = readConfigSection(result.text, "display");
    expect(roundTrip).toEqual(NEW_DISPLAY);
    // Values survive as numbers, not strings.
    expect(typeof roundTrip!.cs).toBe("number");
    expect((roundTrip!.touch as ConfigRecord).i2cAddress).toBe(0x38);
  });

  it("inserts a display section into a config that has none, adding the missing trailing comma", () => {
    const source = [
      "import type { CuttlefishConfig } from '@typecad/cuttlefish/api';",
      "",
      "const config: CuttlefishConfig = {",
      "  entry: './src/main.ui',",
      "  target: 'esp32',",
      "  // hardware section lives below",
      "};",
      "",
      "export default config;",
      "",
    ].join("\n");

    const result = upsertDisplaySection(source, { profile: "ili9341-spi", cs: 5, dc: 21, rst: 22 });
    expect(result.mode).toBe("inserted");
    expect(findSyntaxError(result.text)).toBeNull();

    // The comment before the closing brace survives; a comma appears after the
    // last property; the display block is inserted before `};`.
    expect(result.text).toContain("  target: 'esp32',\n  // hardware section lives below\n  display: {");
    expect(readConfigSection(result.text, "display")).toEqual({ profile: "ili9341-spi", cs: 5, dc: 21, rst: 22 });
    expect(result.text).toContain("};");
  });

  it("keeps an existing trailing comma without doubling it", () => {
    const source = "const config = {\n  entry: './a.ui',\n};\nexport default config;\n";
    const result = upsertDisplaySection(source, { cs: 1 });
    expect(result.text).not.toContain(",,");
    expect(result.text).toContain("  entry: './a.ui',\n  display: {\n    cs: 1,\n  },\n};");
  });

  it("replaces a non-object display initializer wholesale", () => {
    const source = "const config = {\n  display: someVariable,\n};\nexport default config;\n";
    const result = upsertDisplaySection(source, { cs: 2 });
    expect(result.mode).toBe("replaced");
    expect(findSyntaxError(result.text)).toBeNull();
    expect(readConfigSection(result.text, "display")).toEqual({ cs: 2 });
  });

  it("preserves CRLF line endings end-to-end", () => {
    const crlf = DEMO_LIKE_CONFIG.replace(/\n/g, "\r\n");
    const result = upsertDisplaySection(crlf, NEW_DISPLAY);
    expect(result.text).toContain("\r\n");
    // The replacement display body uses CRLF too (cs renders at 4 spaces in the
    // replace-initializer path).
    expect(result.text).toContain("\r\n    cs: 5,\r\n");
    // No bare-LF lines were introduced.
    expect(result.text.split("\r\n").some((line) => line.includes("\n"))).toBe(false);
  });

  it("throws for a config with no recognizable object literal", () => {
    expect(() => upsertDisplaySection("export const notADefault = 1;", {})).toThrow(/no recognizable config object/i);
  });
});

describe("findSyntaxError", () => {
  it("returns null for valid TypeScript and a message for broken text", () => {
    expect(findSyntaxError(DEMO_LIKE_CONFIG)).toBeNull();
    const error = findSyntaxError("const config = { display: {{{} };\nexport default config;");
    expect(error).toMatch(/line 1/i);
  });
});

// ---------------------------------------------------------------------------
// Config discovery
// ---------------------------------------------------------------------------

describe("findCuttlefishConfig", () => {
  it("walks up parent directories until it finds the config", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ui-wizard-"));
    try {
      const nested = path.join(dir, "src", "deep");
      fs.mkdirSync(nested, { recursive: true });
      fs.writeFileSync(path.join(dir, "cuttlefish.config.ts"), "export default {};\n", "utf-8");
      expect(findCuttlefishConfig(nested)).toBe(path.join(dir, "cuttlefish.config.ts"));
      expect(findCuttlefishConfig(os.tmpdir() === dir ? dir : path.join(os.tmpdir(), "definitely-not-here-xyz"))).toBeUndefined();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// Starter .ui template
// ---------------------------------------------------------------------------

describe("renderStarterUi", () => {
  it("uses only documented .ui syntax", () => {
    const text = renderStarterUi(320, 240);
    expect(text).toContain("import { ui } from '@typecad/ui';");
    expect(text).toContain("ui.mount(screen);");
    expect(text).toContain("ui.signal(0)");
    expect(text).toContain("on:click={onTap}");
    expect(text).toContain("taps: {taps}");
    expect(text).toMatch(/<screen>[\s\S]*<\/screen>/);
    expect(text).toMatch(/<style>[\s\S]*<\/style>/);
  });

  it("shrinks text for small mono panels", () => {
    expect(renderStarterUi(128, 64)).toContain("font-size: 12px;");
    expect(renderStarterUi(320, 240)).toContain("font-size: 22px;");
  });
});

// ---------------------------------------------------------------------------
// Round-trip through the real build-side config loader
// ---------------------------------------------------------------------------

describe("wizard output loads through cuttlefish's config loader", () => {
  it("produces a config parseConfigFile accepts with the display intact", async () => {
    const { parseConfigFile } = await import("@typecad/cuttlefish/config-loader");
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ui-wizard-roundtrip-"));
    try {
      const written = upsertDisplaySection(DEMO_LIKE_CONFIG, NEW_DISPLAY);
      const configPath = path.join(dir, "cuttlefish.config.ts");
      fs.writeFileSync(configPath, written.text, "utf-8");

      const parsed = parseConfigFile(configPath);
      expect(parsed).toBeDefined();
      expect(parsed!.display).toBeDefined();
      expect(parsed!.display!.profile).toBe("st7796-spi");
      expect(parsed!.display!.cs).toBe(5);
      expect(parsed!.display!.spiFrequency).toBe(80_000_000);
      expect(parsed!.display!.touch).toBeDefined();
      expect(parsed!.display!.touch!.i2cAddress).toBe(0x38);
      // Untouched sections survive the splice.
      expect(parsed!.entry).toBe("./src/showcase.ui");
      expect(parsed!.target).toBe("esp32");
      expect(parsed!.buildTarget).toBe("esp32:esp32:esp32");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
