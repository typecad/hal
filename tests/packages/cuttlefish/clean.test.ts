// runClean — the `cuttlefish clean` escape hatch. Resolution mirrors build
// (flag > config output.outDir against the entry dir), the generated-dir
// marker gates deletion, and guard rails keep a misconfigured outDir from
// taking user files with it.

import { describe, it, expect, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { runClean, GENERATED_DIR_MARKER } from "../../../packages/cuttlefish/src/clean";
import { generateProjectPackageJson } from "../../../packages/cuttlefish/src/create/templates";

const tmpDirs: string[] = [];

function makeProject(opts?: { outDir?: string }): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cf-clean-"));
  tmpDirs.push(root);
  fs.mkdirSync(path.join(root, "src"), { recursive: true });
  fs.writeFileSync(path.join(root, "src", "main.ts"), "let x: number = 1;\n");
  if (opts?.outDir !== undefined) {
    fs.writeFileSync(path.join(root, "cuttlefish.config.ts"), `export default { entry: './src/main.ts', output: { outDir: '${opts.outDir}' } } as any;`);
  } else {
    fs.writeFileSync(path.join(root, "cuttlefish.config.ts"), "export default { entry: './src/main.ts' } as any;");
  }
  return root;
}

/** A fake generated output dir: marker .gitignore + some build output. */
function makeGenerated(dir: string, marker = true): void {
  fs.mkdirSync(path.join(dir, "build", "zephyr"), { recursive: true });
  if (marker) {
    fs.writeFileSync(path.join(dir, ".gitignore"), `${GENERATED_DIR_MARKER} — do not edit or commit.\n*\n!.gitignore\n`);
  }
  fs.writeFileSync(path.join(dir, "build", "zephyr", "zephyr.elf"), "ELF".repeat(1000));
}

afterEach(() => {
  while (tmpDirs.length) fs.rmSync(tmpDirs.pop()!, { recursive: true, force: true });
});

describe("runClean — configured outDir", () => {
  it("removes the resolved generated dir and reports reclaimed bytes", () => {
    const root = makeProject({ outDir: "./out" });
    const out = path.join(root, "src", "out");
    makeGenerated(out);
    const outcome = runClean({
      projectRoot: root,
      entryPath: path.join(root, "src", "main.ts"),
      configOutDir: "./out",
    });
    expect(outcome.removed).toHaveLength(1);
    expect(outcome.removed[0].dir).toBe(out);
    expect(outcome.removed[0].bytes).toBeGreaterThan(0);
    expect(fs.existsSync(out)).toBe(false);
  });

  it("follows a renamed outDir (resolution mirrors build)", () => {
    const root = makeProject({ outDir: "./generated" });
    const out = path.join(root, "src", "generated");
    makeGenerated(out);
    const outcome = runClean({
      projectRoot: root,
      entryPath: path.join(root, "src", "main.ts"),
      configOutDir: "./generated",
    });
    expect(fs.existsSync(out)).toBe(false);
    expect(fs.existsSync(path.join(root, "src", "main.ts"))).toBe(true);
  });

  it("the --out-dir flag wins over the config value", () => {
    const root = makeProject({ outDir: "./out" });
    const configured = path.join(root, "src", "out");
    const flagged = path.join(root, "elsewhere");
    makeGenerated(configured);
    makeGenerated(flagged);
    runClean({
      projectRoot: root,
      entryPath: path.join(root, "src", "main.ts"),
      outDirOverride: flagged,
      configOutDir: "./out",
    });
    expect(fs.existsSync(configured)).toBe(true);
    expect(fs.existsSync(flagged)).toBe(false);
  });

  it("reports absent dirs without touching anything", () => {
    const root = makeProject({ outDir: "./out" });
    const outcome = runClean({
      projectRoot: root,
      entryPath: path.join(root, "src", "main.ts"),
      configOutDir: "./out",
    });
    expect(outcome.removed).toEqual([]);
    expect(outcome.absent).toEqual([path.join(root, "src", "out")]);
  });
});

describe("runClean — safety rails", () => {
  it("refuses a dir without the generated marker unless --force", () => {
    const root = makeProject({ outDir: "./out" });
    const out = path.join(root, "src", "out");
    makeGenerated(out, false /* no marker */);
    const refused = runClean({
      projectRoot: root,
      entryPath: path.join(root, "src", "main.ts"),
      configOutDir: "./out",
    });
    expect(refused.removed).toEqual([]);
    expect(refused.unmarked).toEqual([out]);
    expect(fs.existsSync(out)).toBe(true);
    const forced = runClean({
      projectRoot: root,
      entryPath: path.join(root, "src", "main.ts"),
      configOutDir: "./out",
      force: true,
    });
    expect(forced.removed).toHaveLength(1);
    expect(fs.existsSync(out)).toBe(false);
  });

  it("refuses outDir values that contain the project root or the entry dir", () => {
    const root = makeProject({ outDir: ".." });
    const parent = runClean({
      projectRoot: root,
      entryPath: path.join(root, "src", "main.ts"),
      configOutDir: "..",
    });
    expect(parent.removed).toEqual([]);
    expect(parent.refused[0].reason).toContain("project root");
    expect(fs.existsSync(path.join(root, "src", "main.ts"))).toBe(true);

    const srcDir = runClean({
      projectRoot: root,
      entryPath: path.join(root, "src", "main.ts"),
      configOutDir: "./src/../src/..",
    });
    expect(srcDir.removed).toEqual([]);
    expect(srcDir.refused[0].reason).toContain("entry file directory");
    expect(fs.existsSync(path.join(root, "src", "main.ts"))).toBe(true);
  });

  it("refuses a dir containing a cuttlefish.config.ts (a project, not output)", () => {
    const root = makeProject({ outDir: "./nested" });
    const nested = path.join(root, "src", "nested");
    makeGenerated(nested);
    fs.writeFileSync(path.join(nested, "cuttlefish.config.ts"), "export default {} as any;");
    const outcome = runClean({
      projectRoot: root,
      entryPath: path.join(root, "src", "main.ts"),
      configOutDir: "./nested",
    });
    expect(outcome.removed).toEqual([]);
    expect(outcome.refused[0].reason).toContain("cuttlefish.config.ts");
  });
});

describe("runClean — in-source emit mode (no configured outDir)", () => {
  it("removes the marker'd strategy subdirs, never the entry dir itself", () => {
    const root = makeProject(); // no output.outDir
    // The entry sits at <root>/src/main.ts; in-source emit targets the
    // generated subdirs beside it — <root>/src/src (zephyr) / <root>/src/.build.
    makeGenerated(path.join(root, "src", "src"));
    makeGenerated(path.join(root, "src", ".build"));
    const outcome = runClean({
      projectRoot: root,
      entryPath: path.join(root, "src", "main.ts"),
    });
    expect(outcome.removed.map((r) => r.dir).sort()).toEqual(
      [path.join(root, "src", ".build"), path.join(root, "src", "src")].sort(),
    );
    expect(fs.existsSync(path.join(root, "src", "main.ts"))).toBe(true);
  });
});

describe("scaffold — npm run clean", () => {
  it("every scaffolded project carries the clean script", () => {
    const base = { projectName: "p", frameworkPackage: "@typecad/framework-zephyr", frameworkId: "zephyr", targetId: "blackpill_f411ce", isNative: false, includeStarter: true } as const;
    const embedded = JSON.parse(generateProjectPackageJson(base as never));
    expect(embedded.scripts.clean).toBe("cuttlefish clean");
    const native = JSON.parse(generateProjectPackageJson({ ...base, frameworkPackage: "@typecad/framework-native", isNative: true } as never));
    expect(native.scripts.clean).toBe("cuttlefish clean");
  });
});
