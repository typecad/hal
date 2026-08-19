// ---------------------------------------------------------------------------
// Config loader hardening — regression tests for the silent-drop bug class.
//
// The loader is AST-only by design (no ts-node / dynamic import), so only
// inline literals survive extraction. These tests pin the fixes that keep
// common TypeScript idioms parsing (negative numbers, `satisfies`/`as const`
// on the export) and ensure every remaining drop surfaces as a console.warn
// instead of vanishing silently (the `libraries: sdlLibraries` link-failure
// bug class).
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseConfigFile } from "../../../packages/cuttlefish/src/config-loader";

function writeConfig(source: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cf-config-"));
  const file = path.join(dir, "cuttlefish.config.ts");
  fs.writeFileSync(file, source, "utf-8");
  return file;
}

let warnSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  warnSpy.mockRestore();
});

function warnedWith(fragment: string): boolean {
  return warnSpy.mock.calls.some((call) =>
    call.some((arg) => typeof arg === "string" && arg.includes(fragment)),
  );
}

describe("parseConfigFile hardening", () => {
  it("parses negative number literals (PrefixUnaryExpression)", () => {
    // demo-ui-sd13 ships `reset: -1` — used to be silently dropped.
    const file = writeConfig(`
      const config = {
        target: 'esp32',
        display: { profile: 'ili9341-spi', cs: 5, rst: -1 },
      };
      export default config;
    `);
    const resolved = parseConfigFile(file);
    expect(resolved).toBeDefined();
    expect((resolved as any).display.rst).toBe(-1);
    expect((resolved as any).display.profile).toBe("ili9341-spi");
    expect((resolved as any).display.cs).toBe(5);
  });

  it("unwraps `satisfies` on the config variable initializer", () => {
    const file = writeConfig(`
      const config = { target: 'esp32', output: { outDir: './gen' } } satisfies Record<string, unknown>;
      export default config;
    `);
    const resolved = parseConfigFile(file);
    expect(resolved?.target).toBe("esp32");
    expect(resolved?.outputOutDir).toBe("./gen");
  });

  it("warns and drops deprecated output.optimize instead of failing validation", () => {
    const file = writeConfig(`
      const config = { target: 'esp32', output: { optimize: 'size', outDir: './out' } };
      export default config;
    `);
    // Must not throw (strict schema no longer accepts the key — the loader
    // drops it before validation) and must tell the user to remove it.
    const resolved = parseConfigFile(file);
    expect(resolved?.target).toBe("esp32");
    expect(resolved?.outputOutDir).toBe("./out");
    expect((resolved as Record<string, unknown>).outputOptimize).toBeUndefined();
    expect(warnedWith("'output.optimize' has no effect")).toBe(true);
  });

  it("unwraps `as const` / parenthesized on the inline default export", () => {
    const file = writeConfig(`
      export default ({ target: 'avr' }) as const;
    `);
    const resolved = parseConfigFile(file);
    expect(resolved?.target).toBe("avr");
  });

  it("warns when an identifier value is silently dropped (the sdlLibraries bug)", () => {
    const file = writeConfig(`
      const sdlLibraries = ['SDL2'];
      const config = {
        target: 'esp32',
        native: { cxxStandard: 'c++17', libraries: sdlLibraries },
      };
      export default config;
    `);
    const resolved = parseConfigFile(file);
    expect(resolved?.frameworkConfig).toBeDefined();
    expect(resolved!.frameworkConfig!.cxxStandard).toBe("c++17");
    // The identifier could not be evaluated — the key must be absent AND a
    // warning must name it (previously this vanished with no diagnostic and
    // surfaced later as missing -l flags at link time).
    expect(resolved!.frameworkConfig!.libraries).toBeUndefined();
    expect(warnedWith("native.libraries")).toBe(true);
    expect(warnedWith("not an inline literal")).toBe(true);
  });

  it("warns when a non-string element drops the whole array", () => {
    const file = writeConfig(`
      const variant = 2;
      const config = { output: { extraFlags: ['-DX=1', '-DV=' + variant] } };
      export default config;
    `);
    const resolved = parseConfigFile(file);
    expect(resolved?.outputExtraFlags).toBeUndefined();
    expect(warnedWith("output.extraFlags")).toBe(true);
    expect(warnedWith("non-string-literal element")).toBe(true);
  });

  it("warns on ternary values the parser cannot evaluate", () => {
    const file = writeConfig(`
      const config = { target: 'esp32', console: { port: process.platform === 'win32' ? 'COM3' : '/dev/ttyACM0' } };
      export default config;
    `);
    const resolved = parseConfigFile(file);
    expect(resolved?.console?.port).toBeUndefined();
    expect(warnedWith("console.port")).toBe(true);
    expect(warnedWith("not an inline literal")).toBe(true);
  });

  it("warns on misspelled top-level keys (dead strict-schema detection)", () => {
    const file = writeConfig(`
      const config = { target: 'esp32', outputs: { optimize: 'speed' } };
      export default config;
    `);
    parseConfigFile(file);
    expect(warnedWith("unknown top-level key 'outputs'")).toBe(true);
  });

  it("collapses the double walk into one warning for shorthand properties", () => {
    // `native` is walked by both walkObjectLiteral and extractObjectAsRecord;
    // their non-property-assignment messages must be byte-identical so the
    // warn-site dedup prints one warning per dropped value, not two.
    const file = writeConfig(`
      const cxxStandard = 'c++17';
      const config = { target: 'esp32', native: { cxxStandard } };
      export default config;
    `);
    parseConfigFile(file);
    const shorthandWarnings = warnSpy.mock.calls.filter((call) =>
      call.some((arg) => typeof arg === "string" && arg.includes("ShorthandProperty")),
    );
    expect(shorthandWarnings).toHaveLength(1);
    expect(warnedWith("'native.cxxStandard' uses ShorthandPropertyAssignment syntax")).toBe(true);
  });

  it("warns accurately for null/undefined literals (not 'variables/ternaries')", () => {
    const file = writeConfig(`
      const config = { target: 'esp32', console: { port: null } };
      export default config;
    `);
    const resolved = parseConfigFile(file);
    expect(resolved?.console?.port).toBeUndefined();
    expect(warnedWith("'console.port' is a null/undefined literal")).toBe(true);
    expect(warnedWith("variables, ternaries")).toBe(false);
  });

  it("rejects an empty-string psram instead of silently dropping it", () => {
    // `psram: ''` used to skip validation via a truthiness guard and vanish.
    const file = writeConfig(`
      const config = { target: 'esp32', psram: '' };
      export default config;
    `);
    expect(() => parseConfigFile(file)).toThrow(/psram/);
  });

  it("emits no warnings for a clean inline-literal config", () => {
    const file = writeConfig(`
      const config = {
        entry: './src/main.ts',
        target: 'esp32',
        output: { extraFlags: ['-DX=1'] },
        console: { port: 'COM3', baudRate: 115200 },
        native: { cxxStandard: 'c++17', libraries: ['curl'] },
      };
      export default config;
    `);
    const resolved = parseConfigFile(file);
    expect(resolved?.target).toBe("esp32");
    expect(resolved?.outputExtraFlags).toEqual(["-DX=1"]);
    expect(resolved?.console?.baudRate).toBe(115200);
    expect(resolved!.frameworkConfig!.libraries).toEqual(["curl"]);
    expect(warnSpy).not.toHaveBeenCalled();
  });
});
