// ---------------------------------------------------------------------------
// Tests for the ESLint build gate (Phase 1 of the semantic-gate plan).
//
// Verifies that runEslintCheck surfaces violations with structured file/line/
// column/ruleId/sourceLine, and that it returns [] when no config or no src
// is present. The typecad-hal-package fallback resolver is what makes eslint
// resolvable from these temp project roots.
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { runEslintCheck } from "@typecad/cuttlefish/testing";

// Temp projects live INSIDE the repo's node_modules tree so that Node's
// upward module resolution finds @typescript-eslint/* and eslint installed at
// the repo root (scaffolded user projects get these via `npm install`).
// node_modules/ is gitignored, so nothing leaks into version control.
const TMP_ROOT = path.join(process.cwd(), "node_modules", ".cache", "typecad-hal-eslint-tests");

let tmpDir: string;

function writeFile(relPath: string, content: string): void {
  const full = path.join(tmpDir, relPath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content, "utf-8");
}

beforeEach(() => {
  fs.mkdirSync(TMP_ROOT, { recursive: true });
  tmpDir = fs.mkdtempSync(path.join(TMP_ROOT, "project-"));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// A minimal flat config that bans explicit `any`, mirroring the rule scaffolded
// into new user projects (templates.ts generateEslintConfig).
const FLAT_CONFIG = `import tseslint from "@typescript-eslint/eslint-plugin";
import tsparser from "@typescript-eslint/parser";

export default [
  {
    files: ["src/**/*.ts"],
    languageOptions: { parser: tsparser },
    plugins: { "@typescript-eslint": tseslint },
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
    },
  },
];
`;

describe("ESLint gate (runEslintCheck)", () => {
  it("returns [] when no eslint config is present", async () => {
    writeFile("src/main.ts", "const x: any = 1;\n");
    const errors = await runEslintCheck(tmpDir);
    expect(errors).toEqual([]);
  });

  it("returns [] when no src/ directory is present", async () => {
    writeFile("eslint.config.mjs", FLAT_CONFIG);
    const errors = await runEslintCheck(tmpDir);
    expect(errors).toEqual([]);
  });

  it("surfaces explicit-any violations with structured location and ruleId", async () => {
    writeFile("eslint.config.mjs", FLAT_CONFIG);
    writeFile("src/main.ts", "const x: any = 1;\nconsole.log(x);\n");

    const errors = await runEslintCheck(tmpDir);

    expect(errors.length).toBeGreaterThanOrEqual(1);
    const anyError = errors.find(e => e.ruleId === "@typescript-eslint/no-explicit-any");
    expect(anyError).toBeDefined();
    expect(anyError!.line).toBe(1);
    expect(anyError!.column).toBeGreaterThanOrEqual(1);
    expect(anyError!.filePath).toContain("main.ts");
    expect(anyError!.sourceLine).toContain("any");
  });

  it("returns [] for clean code that satisfies the configured rules", async () => {
    writeFile("eslint.config.mjs", FLAT_CONFIG);
    writeFile("src/main.ts", "const x: number = 1;\nconsole.log(x);\n");

    const errors = await runEslintCheck(tmpDir);
    expect(errors).toEqual([]);
  });

  // Regression: the ESLint gate used to be called with the entry file's
  // directory (i.e. src/) as projectRoot, so the config at the real project
  // root was never found and the gate silently returned []. The fix threads
  // the config-derived project root through transpileFile. This test mirrors
  // that layout: config at the project root, source under src/, and asserts
  // violations are still surfaced when projectRoot points at the root (not src/).
  it("surfaces violations when config is at project root and source is under src/", async () => {
    writeFile("eslint.config.mjs", FLAT_CONFIG);
    writeFile("src/main.ts", "const x: any = 1;\nconsole.log(x);\n");

    // projectRoot must be the directory holding eslint.config.mjs, not src/.
    const errors = await runEslintCheck(tmpDir);

    expect(errors.length).toBeGreaterThanOrEqual(1);
    const anyError = errors.find(e => e.ruleId === "@typescript-eslint/no-explicit-any");
    expect(anyError).toBeDefined();
    expect(anyError!.filePath).toContain("main.ts");
  });

  // Regression: a config that exists but cannot be loaded (broken import,
  // missing plugin, etc.) used to make the gate silently no-op. It must now
  // throw so the build stops loudly instead of skipping linting.
  it("throws when the eslint config exists but cannot be loaded", async () => {
    writeFile("eslint.config.mjs", `import missing from "./does-not-exist.mjs";\nexport default [];\n`);
    writeFile("src/main.ts", "const x: any = 1;\n");

    await expect(runEslintCheck(tmpDir)).rejects.toThrow(/could not be loaded/);
  });

  // A pure-.ui project has src/ with no .ts files. ESLint raises "All files
  // matched by ... are ignored" — that is a legitimate no-op, not a config
  // failure, so the gate must return [] and let the build proceed.
  it("returns [] when src/ has no lintable .ts files (all ignored)", async () => {
    writeFile("eslint.config.mjs", FLAT_CONFIG);
    writeFile("src/showcase.ui", "<screen></screen>\n");

    const errors = await runEslintCheck(tmpDir);
    expect(errors).toEqual([]);
  });
});
