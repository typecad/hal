import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

// Validates the board test-pins contract without hardware and without built
// package output (exports are collected textually from package sources, so
// this runs in CI before the build step):
//
//   1. Every boards/*/test-pins.json parses and every pin role names a symbol
//      the board package actually exports (following `export *` chains into
//      the MCU package).
//   2. Every packages/hal/boards/*.config.ts names a board package that
//      exists and ships a test-pins.json, and its include patterns point at
//      real directories under packages/hal/tests.
//   3. Every board package with an `npm run hal` script has a matching config.

const repoRoot = process.cwd();
const boardsDir = path.join(repoRoot, "boards");
const halBoardsDir = path.join(repoRoot, "packages", "hal", "boards");

const PIN_ROLES = ["gpioOut", "gpioIn", "gpioGroup", "pwm", "pwmAlt", "cs", "interrupt", "led", "button"] as const;
const FACT_ROLES = ["pwmMaxFrequency", "pwmResolutionBits", "adcMax"] as const;
const HEX_ID_RE = /^[0-9a-fA-F]{1,4}$/;

function listBoardPackages(): { name: string; dir: string }[] {
  return fs
    .readdirSync(boardsDir)
    .filter((entry) => fs.existsSync(path.join(boardsDir, entry, "package.json")))
    .sort()
    .map((entry) => ({
      name: JSON.parse(fs.readFileSync(path.join(boardsDir, entry, "package.json"), "utf8")).name,
      dir: path.join(boardsDir, entry),
    }));
}

/**
 * Collect exported top-level names from a package's TS sources, following
 * `export * from '<spec>'` into in-repo packages (board -> MCU chains).
 */
function collectExportedNames(pkgDir: string, seen = new Set<string>()): Set<string> {
  const key = path.resolve(pkgDir);
  if (seen.has(key)) return new Set();
  seen.add(key);

  const names = new Set<string>();
  const srcDir = path.join(pkgDir, "src");
  if (!fs.existsSync(srcDir)) return names;

  const walk = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort()) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (!entry.name.endsWith(".ts") || entry.name.endsWith(".d.ts")) continue;
      const source = fs.readFileSync(full, "utf8");

      for (const m of source.matchAll(/export\s+(?:declare\s+)?const\s+([A-Za-z_$][\w$]*)/g)) {
        names.add(m[1]);
      }
      for (const m of source.matchAll(/export\s*\{([^}]+)\}/g)) {
        for (const part of m[1].split(",")) {
          const clause = part.trim();
          if (!clause) continue;
          // `A` or `A as B` — the exported name is the last identifier.
          const asMatch = clause.match(/^[\w$]+(?:\s+as\s+([\w$]+))?$/);
          if (asMatch) names.add(asMatch[1] ?? clause);
        }
      }
      for (const m of source.matchAll(/export\s+\*\s+from\s+['"]([^'"]+)['"]/g)) {
        const specifier = m[1];
        if (!specifier.startsWith("@typecad/")) continue;
        const short = specifier.replace("@typecad/", "");
        // board packages live in boards/, mcu packages in mcus/, the rest in packages/.
        const resolved = [
          path.join(repoRoot, "mcus", short),
          path.join(repoRoot, "packages", short),
          path.join(repoRoot, "boards", short),
        ].find((c) => fs.existsSync(path.join(c, "package.json")));
        if (resolved) {
          for (const name of collectExportedNames(resolved, seen)) names.add(name);
        }
      }
    }
  };
  walk(srcDir);
  return names;
}

function readTestPins(pkgDir: string): { pins?: Record<string, unknown>; facts?: Record<string, unknown> } | undefined {
  const p = path.join(pkgDir, "test-pins.json");
  if (!fs.existsSync(p)) return undefined;
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

function listHalBoardConfigs(): { file: string; board: string }[] {
  return fs
    .readdirSync(halBoardsDir)
    .filter((f) => f.endsWith(".config.ts"))
    .sort()
    .map((f) => {
      const source = fs.readFileSync(path.join(halBoardsDir, f), "utf8");
      const board = source.match(/board:\s*'(@typecad\/[\w-]+)'/)?.[1];
      return { file: f, board: board ?? "" };
    });
}

describe("Board test-pins contract", () => {
  const boards = listBoardPackages();

  it("finds the expected set of board packages", () => {
    expect(boards.length).toBeGreaterThanOrEqual(9);
  });

  for (const { name, dir } of boards) {
    describe(name, () => {
      const data = readTestPins(dir);

      if (data) {
        it("test-pins.json roles are known and pins resolve to package exports", () => {
          const exported = collectExportedNames(dir);
          const unknownRoles = Object.keys(data.pins ?? {})
            .concat(Object.keys(data.facts ?? {}))
            .filter((r) => ![...PIN_ROLES, ...FACT_ROLES].includes(r as never));
          expect(unknownRoles).toEqual([]);

          const missing: string[] = [];
          for (const [role, value] of Object.entries(data.pins ?? {})) {
            const pinNames = Array.isArray(value) ? value : [value];
            for (const pin of pinNames) {
              if (typeof pin !== "string" || !exported.has(pin)) {
                missing.push(`${role}: ${String(pin)}`);
              }
            }
          }
          expect(missing, `${name} does not export the pins named in test-pins.json`).toEqual([]);

          for (const [role, value] of Object.entries(data.facts ?? {})) {
            expect(typeof value === "number" && Number.isFinite(value), `fact ${role} must be a finite number`).toBe(true);
          }

          // USB identity (port discovery for multi-board rigs): vid/pid are
          // 1–4 hex digits; serial is optional.
          if (data.usb) {
            expect(HEX_ID_RE.test(data.usb.vid ?? ""), "usb.vid must be 1-4 hex digits").toBe(true);
            expect(HEX_ID_RE.test(data.usb.pid ?? ""), "usb.pid must be 1-4 hex digits").toBe(true);
            if (data.usb.serial !== undefined) {
              expect(typeof data.usb.serial, "usb.serial must be a string when present").toBe("string");
            }
          }
        });
      }
    });
  }

  for (const { file, board } of listHalBoardConfigs()) {
    it(`${file} targets a board package that ships test-pins.json`, () => {
      expect(board, `${file} must declare a board package`).not.toBe("");
      const boardDir = path.join(repoRoot, "boards", board.replace("@typecad/", ""));
      expect(fs.existsSync(path.join(boardDir, "package.json")), `${board} package exists`).toBe(true);
      expect(fs.existsSync(path.join(boardDir, "test-pins.json")), `${board} ships test-pins.json`).toBe(true);
    });

    it(`${file} include patterns point at real suite directories`, () => {
      const source = fs.readFileSync(path.join(halBoardsDir, file), "utf8");
      const includes = [...source.matchAll(/'((?:tests|[^']*)\/[^']*\.test\.ts)'/g)].map((m) => m[1]);
      const suiteRoot = path.join(repoRoot, "packages", "hal");
      for (const pattern of includes) {
        const dir = path.join(suiteRoot, path.dirname(pattern));
        expect(fs.existsSync(dir), `include pattern '${pattern}' has no matching directory`).toBe(true);
      }
    });
  }

  it("every board package with an 'hal' script has a matching config", () => {
    for (const { name, dir } of boards) {
      const pkg = JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8"));
      if (!pkg.scripts?.hal) continue;
      const match = pkg.scripts.hal.match(/boards\/([\w-]+)\.config\.ts/);
      expect(match, `${name} hal script references a config`).toBeTruthy();
      const configPath = path.join(halBoardsDir, `${match![1]}.config.ts`);
      expect(fs.existsSync(configPath), `${name} hal script config exists`).toBe(true);
      const configSource = fs.readFileSync(configPath, "utf8");
      expect(configSource).toContain(`board: '${name}'`);
    }
  });
});
