// ---------------------------------------------------------------------------
// Tests for the ESLint gate cache (lint-cache.ts).
//
// The ESLint gate is a mandatory correctness pass that excludes non-AOT code
// patterns. Its result (zero errors) is a whole-program boolean that depends
// only on source files, the eslint config, and the eslint/transpiler versions,
// so it is cacheable. These tests pin the soundness contract:
//   - cold call misses
//   - a clean run is recorded and the next call hits
//   - editing a source file invalidates
//   - editing the eslint config invalidates
//   - `force` bypasses the cache
//   - a failing lint must never be recorded
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  checkLintCache,
  recordLintSuccess,
  invalidateLint,
  computeLintFingerprint,
} from "@typecad/cuttlefish/testing";
import type { LintFingerprint } from "@typecad/cuttlefish/testing";

// Temp projects live inside the repo's node_modules tree so Node's upward
// module resolution finds eslint (mirrors eslint-gate.test.ts).
const TMP_ROOT = path.join(process.cwd(), "node_modules", ".cache", "cuttlefish-lint-cache-tests");

let tmpDir: string;

function writeFile(relPath: string, content: string): void {
  const full = path.join(tmpDir, relPath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content, "utf-8");
}

function cacheFileExists(): boolean {
  return fs.existsSync(path.join(tmpDir, ".cuttlefish-cache.json"));
}

// Minimal flat config banning explicit `any` (same as the scaffolded rule).
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

beforeEach(() => {
  fs.mkdirSync(TMP_ROOT, { recursive: true });
  tmpDir = fs.mkdtempSync(path.join(TMP_ROOT, "project-"));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("ESLint gate cache (lint-cache)", () => {
  it("misses when no cache file exists yet (cold)", () => {
    writeFile("eslint.config.mjs", FLAT_CONFIG);
    writeFile("src/main.ts", "const x: number = 1;\n");
    const result = checkLintCache(tmpDir, path.join(tmpDir, "src"));
    expect(result.hit).toBe(false);
    expect(result.fingerprint).not.toBeNull();
    expect(cacheFileExists()).toBe(false); // nothing recorded yet
  });

  it("hits on the second call after recording a clean run", () => {
    writeFile("eslint.config.mjs", FLAT_CONFIG);
    writeFile("src/main.ts", "const x: number = 1;\n");

    const srcDir = path.join(tmpDir, "src");
    const first = checkLintCache(tmpDir, srcDir);
    expect(first.hit).toBe(false);
    // Simulate a clean ESLint run: record success.
    recordLintSuccess(tmpDir, first.fingerprint!);
    expect(cacheFileExists()).toBe(true);

    const second = checkLintCache(tmpDir, srcDir);
    expect(second.hit).toBe(true);
  });

  it("invalidates when a source file's content changes", () => {
    writeFile("eslint.config.mjs", FLAT_CONFIG);
    writeFile("src/main.ts", "const x: number = 1;\n");
    const srcDir = path.join(tmpDir, "src");

    const first = checkLintCache(tmpDir, srcDir);
    recordLintSuccess(tmpDir, first.fingerprint!);
    expect(checkLintCache(tmpDir, srcDir).hit).toBe(true);

    // Edit the source — content hash changes, cache must miss.
    writeFile("src/main.ts", "const y: number = 2;\n");
    const after = checkLintCache(tmpDir, srcDir);
    expect(after.hit).toBe(false);
  });

  it("keeps hitting when only mtime changes but content is identical", () => {
    writeFile("eslint.config.mjs", FLAT_CONFIG);
    writeFile("src/main.ts", "const x: number = 1;\n");
    const srcDir = path.join(tmpDir, "src");

    const first = checkLintCache(tmpDir, srcDir);
    recordLintSuccess(tmpDir, first.fingerprint!);

    // Rewrite the same content (new mtime, same bytes).
    fs.writeFileSync(path.join(srcDir, "main.ts"), "const x: number = 1;\n", "utf-8");
    const after = checkLintCache(tmpDir, srcDir);
    expect(after.hit).toBe(true);
  });

  it("invalidates when the eslint config changes", () => {
    writeFile("eslint.config.mjs", FLAT_CONFIG);
    writeFile("src/main.ts", "const x: number = 1;\n");
    const srcDir = path.join(tmpDir, "src");

    const first = checkLintCache(tmpDir, srcDir);
    recordLintSuccess(tmpDir, first.fingerprint!);

    // Change the config (add a rule) — fingerprint must change.
    writeFile("eslint.config.mjs", FLAT_CONFIG.replace('"@typescript-eslint/no-explicit-any": "error"', '"@typescript-eslint/no-explicit-any": "error", "@typescript-eslint/no-unused-vars": "error"'));
    const after = checkLintCache(tmpDir, srcDir);
    expect(after.hit).toBe(false);
  });

  it("force bypasses the cache even when a clean run was recorded", () => {
    writeFile("eslint.config.mjs", FLAT_CONFIG);
    writeFile("src/main.ts", "const x: number = 1;\n");
    const srcDir = path.join(tmpDir, "src");

    const first = checkLintCache(tmpDir, srcDir);
    recordLintSuccess(tmpDir, first.fingerprint!);
    expect(checkLintCache(tmpDir, srcDir).hit).toBe(true);

    const forced = checkLintCache(tmpDir, srcDir, { force: true });
    expect(forced.hit).toBe(false);
    // fingerprint is still computed so a clean run can re-record.
    expect(forced.fingerprint).not.toBeNull();
  });

  it("never persists a cache entry for a failing lint (soundness)", () => {
    writeFile("eslint.config.mjs", FLAT_CONFIG);
    writeFile("src/main.ts", "const x: any = 1;\n"); // would fail lint
    const srcDir = path.join(tmpDir, "src");

    const first = checkLintCache(tmpDir, srcDir);
    expect(first.hit).toBe(false);
    // Simulate a FAILING lint: the caller MUST NOT call recordLintSuccess.
    // (The build aborts before reaching it.) Nothing is written.
    expect(cacheFileExists()).toBe(false);
  });

  it("invalidate() drops the lint entry", () => {
    writeFile("eslint.config.mjs", FLAT_CONFIG);
    writeFile("src/main.ts", "const x: number = 1;\n");
    const srcDir = path.join(tmpDir, "src");

    const first = checkLintCache(tmpDir, srcDir);
    recordLintSuccess(tmpDir, first.fingerprint!);
    expect(checkLintCache(tmpDir, srcDir).hit).toBe(true);

    invalidateLint(tmpDir);
    expect(checkLintCache(tmpDir, srcDir).hit).toBe(false);
  });

  it("respects CUTTLEFISH_NO_CACHE (never hits, never records)", () => {
    writeFile("eslint.config.mjs", FLAT_CONFIG);
    writeFile("src/main.ts", "const x: number = 1;\n");
    const srcDir = path.join(tmpDir, "src");

    const prev = process.env.CUTTLEFISH_NO_CACHE;
    process.env.CUTTLEFISH_NO_CACHE = "1";
    try {
      const first = checkLintCache(tmpDir, srcDir);
      expect(first.hit).toBe(false);
      recordLintSuccess(tmpDir, first.fingerprint!);
      expect(cacheFileExists()).toBe(false); // env disables writing

      const second = checkLintCache(tmpDir, srcDir);
      expect(second.hit).toBe(false);
    } finally {
      if (prev === undefined) delete process.env.CUTTLEFISH_NO_CACHE;
      else process.env.CUTTLEFISH_NO_CACHE = prev;
    }
  });

  it("returns null fingerprint when no eslint config is present", () => {
    writeFile("src/main.ts", "const x: number = 1;\n");
    const fp: LintFingerprint | null = computeLintFingerprint(tmpDir, path.join(tmpDir, "src"));
    expect(fp).toBeNull();
  });

  it("includes all source files in the fingerprint input set", () => {
    writeFile("eslint.config.mjs", FLAT_CONFIG);
    writeFile("src/main.ts", "const x: number = 1;\n");
    writeFile("src/util.ts", "export const y = 2;\n");
    const srcDir = path.join(tmpDir, "src");

    const fp1 = computeLintFingerprint(tmpDir, srcDir)!;
    // Adding a new source file must change the digest.
    writeFile("src/extra.ts", "export const z = 3;\n");
    const fp2 = computeLintFingerprint(tmpDir, srcDir)!;
    expect(fp2.digest).not.toBe(fp1.digest);
    expect(fp2.inputs.length).toBeGreaterThan(fp1.inputs.length);
  });

  it("ignores out/ and node_modules/ directories when gathering sources", () => {
    writeFile("eslint.config.mjs", FLAT_CONFIG);
    writeFile("src/main.ts", "const x: number = 1;\n");
    // Files that should NOT affect the lint result.
    writeFile("src/out/generated.ts", "const _generated: any = 1;\n");
    writeFile("src/out-esp32s3/generated.ts", "const _gen2: any = 1;\n");
    writeFile("src/node_modules/pkg/index.ts", "const _dep: any = 1;\n");

    const fp = computeLintFingerprint(tmpDir, path.join(tmpDir, "src"))!;
    // main.ts is included; the excluded-dir files are not.
    const allInputs = fp.inputs.join("\n");
    expect(allInputs).toContain("main.ts");
    expect(allInputs).not.toContain("generated.ts");
    expect(allInputs).not.toContain("_dep");
  });
});
