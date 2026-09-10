// ---------------------------------------------------------------------------
// Tests for the ESLint boilerplate regeneration + fail-loud gate contract.
//
// The ESLint gate excludes non-AOT code patterns; its config pair
// (.typecad-hal/eslint.config.mjs + eslint-transpiler-rules.mjs) is generated
// from LINT_RULES and gitignored with the promise "regenerated on build".
// That promise is kept by ensureLintBoilerplate (config-loader), called from
// the CLI transpile funnel. These tests pin:
//   - the pair materializes for a configured project that never ran create
//     (the fresh-clone case), and stays pinned to the generator output
//   - regeneration is skipped for the explicit opt-out (lint: false) and for
//     projects owning a root-level eslint config (legacy demo layout)
//   - `lint` survives config extraction as a boolean, false intact
//   - runEslintCheck fails loudly for a configured project with no config
//     anywhere, instead of silently no-op'ing the gate
//   - the regenerated config produces a WORKING gate (catches explicit any)
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseConfigFile, ensureLintBoilerplate } from "../../../packages/cuttlefish/src/config-loader";
import { runEslintCheck } from "../../../packages/cuttlefish/src/eslint-check";
import { generateEslintConfig } from "../../../packages/cuttlefish/src/create/templates";
import { generateEslintRules } from "../../../packages/cuttlefish/src/create/eslint-rules-template";

const tmpDirs: string[] = [];

function makeProject(configSource = "const config = { entry: './src/main.ts' };\nexport default config;\n"): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cf-lint-boiler-"));
  tmpDirs.push(dir);
  fs.mkdirSync(path.join(dir, "src"), { recursive: true });
  fs.writeFileSync(path.join(dir, "typecad-hal.config.ts"), configSource, "utf-8");
  fs.writeFileSync(path.join(dir, "src", "main.ts"), "export function main(): void {}\n", "utf-8");
  return dir;
}

afterEach(() => {
  for (const dir of tmpDirs) fs.rmSync(dir, { recursive: true, force: true });
  tmpDirs.length = 0;
});

describe("config extraction: lint", () => {
  it("preserves lint: false (the explicit opt-out) through extraction", () => {
    const dir = makeProject("const config = { entry: './src/main.ts', lint: false };\nexport default config;\n");
    const resolved = parseConfigFile(path.join(dir, "typecad-hal.config.ts"));
    expect(resolved?.lint).toBe(false);
  });

  it("extracts lint: true", () => {
    const dir = makeProject("const config = { entry: './src/main.ts', lint: true };\nexport default config;\n");
    const resolved = parseConfigFile(path.join(dir, "typecad-hal.config.ts"));
    expect(resolved?.lint).toBe(true);
  });

  it("leaves lint undefined when absent", () => {
    const dir = makeProject();
    const resolved = parseConfigFile(path.join(dir, "typecad-hal.config.ts"));
    expect(resolved?.lint).toBeUndefined();
  });
});

describe("ensureLintBoilerplate", () => {
  it("materializes the eslint pair for a configured project (fresh-clone heal)", () => {
    const dir = makeProject();
    const resolved = parseConfigFile(path.join(dir, "typecad-hal.config.ts"))!;

    ensureLintBoilerplate(resolved);

    const config = fs.readFileSync(path.join(dir, ".typecad-hal", "eslint.config.mjs"), "utf-8");
    const rules = fs.readFileSync(path.join(dir, ".typecad-hal", "eslint-transpiler-rules.mjs"), "utf-8");
    expect(config).toBe(generateEslintConfig());
    expect(config).toContain("no-restricted-syntax");
    expect(rules).toBe(generateEslintRules());
  });

  it("creates .typecad-hal/ when missing and restores a diverged (hand-edited) config", () => {
    const dir = makeProject();
    const resolved = parseConfigFile(path.join(dir, "typecad-hal.config.ts"))!;
    ensureLintBoilerplate(resolved);

    // A hand-edited or corrupted config is regenerated back to the generated
    // rule set — the pair tracks the engine, like env.d.ts.
    fs.writeFileSync(path.join(dir, ".typecad-hal", "eslint.config.mjs"), "// clobbered\n", "utf-8");
    ensureLintBoilerplate(resolved);
    expect(fs.readFileSync(path.join(dir, ".typecad-hal", "eslint.config.mjs"), "utf-8"))
      .toBe(generateEslintConfig());
  });

  it("skips regeneration when a root-level eslint config owns the project (legacy layout)", () => {
    const dir = makeProject();
    fs.writeFileSync(path.join(dir, "eslint.config.mjs"), "export default [];\n", "utf-8");
    const resolved = parseConfigFile(path.join(dir, "typecad-hal.config.ts"))!;

    ensureLintBoilerplate(resolved);

    expect(fs.existsSync(path.join(dir, ".typecad-hal", "eslint.config.mjs"))).toBe(false);
  });

  it("skips regeneration for the explicit opt-out (lint: false)", () => {
    const dir = makeProject("const config = { entry: './src/main.ts', lint: false };\nexport default config;\n");
    const resolved = parseConfigFile(path.join(dir, "typecad-hal.config.ts"))!;

    ensureLintBoilerplate(resolved);

    expect(fs.existsSync(path.join(dir, ".typecad-hal", "eslint.config.mjs"))).toBe(false);
  });
});

describe("runEslintCheck fail-loud contract", () => {
  it("throws for a configured project with no eslint config anywhere", async () => {
    const dir = makeProject();
    await expect(runEslintCheck(dir)).rejects.toThrow(/No ESLint config found/);
  });

  it("message spells out both remedies (regenerate, or lint: false)", async () => {
    const dir = makeProject();
    const err = await runEslintCheck(dir).catch(e => e as Error);
    expect(err.message).toContain("typecad-hal build");
    expect(err.message).toContain("lint: false");
  });

  it("regenerated boilerplate yields a working gate (catches explicit any)", async () => {
    // Live under the repo's node_modules so eslint + @typescript-eslint/*
    // resolve upward, mirroring eslint-gate.test.ts.
    const root = path.join(process.cwd(), "node_modules", ".cache", "typecad-hal-lint-boiler-tests");
    fs.mkdirSync(root, { recursive: true });
    const dir = fs.mkdtempSync(path.join(root, "project-"));
    tmpDirs.push(dir);
    fs.mkdirSync(path.join(dir, "src"), { recursive: true });
    fs.writeFileSync(path.join(dir, "typecad-hal.config.ts"), "const config = { entry: './src/main.ts' };\nexport default config;\n", "utf-8");
    fs.writeFileSync(path.join(dir, "src", "main.ts"), "const x: any = 1;\nconsole.log(x);\n", "utf-8");

    const resolved = parseConfigFile(path.join(dir, "typecad-hal.config.ts"))!;
    ensureLintBoilerplate(resolved);

    const errors = await runEslintCheck(dir);
    const anyError = errors.find(e => e.ruleId === "@typescript-eslint/no-explicit-any");
    expect(anyError).toBeDefined();
    expect(anyError!.line).toBe(1);
  });
});
