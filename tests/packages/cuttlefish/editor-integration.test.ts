import { describe, it, expect, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { minimatch } from "minimatch";

import { writeEditorIntegration } from "../../../packages/cuttlefish/src/create/editor-integration";

const tmpDirs: string[] = [];

function makeProject(withDevScript = true, preexistingSettings?: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "typecad-hal-editor-"));
  tmpDirs.push(dir);
  fs.mkdirSync(path.join(dir, ".vscode"), { recursive: true });
  if (withDevScript) {
    fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ scripts: { dev: "typecad-hal build --watch" } }));
  }
  if (preexistingSettings) {
    fs.writeFileSync(path.join(dir, ".vscode", "settings.json"), preexistingSettings);
  }
  return dir;
}

afterEach(() => {
  while (tmpDirs.length) fs.rmSync(tmpDirs.pop()!, { recursive: true, force: true });
});

describe("writeEditorIntegration hideNpm settings", () => {
  it("excludes only the bundled extensions' package.json from npm, not the root one", () => {
    const dir = makeProject();
    writeEditorIntegration(dir, undefined, true);
    const settings = JSON.parse(fs.readFileSync(path.join(dir, ".vscode", "settings.json"), "utf-8"));
    // VS Code evaluates npm.exclude exactly this way (extensions/npm/src/tasks.ts,
    // isExcluded): minimatch the package.json's PARENT DIRECTORY with dot:true.
    // A pattern ending in "/package.json" can never match a directory — which is
    // how the bundled extension manifests leaked into the NPM Scripts view.
    const excludedByVSCode = (packageJsonPath: string) =>
      minimatch(path.dirname(path.resolve(packageJsonPath)), settings["npm.exclude"], { dot: true });
    expect(excludedByVSCode(path.join(dir, ".vscode", "extensions", "typecad-ui", "package.json"))).toBe(true);
    expect(excludedByVSCode(path.join(dir, ".vscode", "extensions", "vscode-typecad-debug", "package.json"))).toBe(true);
    expect(excludedByVSCode(path.join(dir, ".vscode", "extensions", "typecad-intel", "package.json"))).toBe(true);
    expect(excludedByVSCode(path.join(dir, "package.json"))).toBe(false);
  });

  it("keeps the NPM Scripts pane working (autoDetect on, explicit — heals older 'off' scaffolds)", () => {
    const dir = makeProject(true, `${JSON.stringify({ "npm.autoDetect": "off" }, null, 2)}\n`);
    writeEditorIntegration(dir, undefined, true);
    const settings = JSON.parse(fs.readFileSync(path.join(dir, ".vscode", "settings.json"), "utf-8"));
    expect(settings["npm.autoDetect"]).toBe("on");
  });

  it("hides the bundled extensions folder from the Explorer and search", () => {
    const dir = makeProject();
    writeEditorIntegration(dir, undefined, true);
    const settings = JSON.parse(fs.readFileSync(path.join(dir, ".vscode", "settings.json"), "utf-8"));
    expect(settings["files.exclude"]).toEqual({ ".vscode/extensions": true });
    expect(settings["search.exclude"]).toEqual({ "**/.vscode/extensions": true });
  });

  it("merges files.exclude with pre-existing user entries instead of clobbering", () => {
    const dir = makeProject(true, `${JSON.stringify({
      "cortex-debug.openocdConfigFiles": ["openocd.cfg"],
      "files.exclude": { "**/*.map": true },
    }, null, 2)}\n`);
    writeEditorIntegration(dir, undefined, true);
    const settings = JSON.parse(fs.readFileSync(path.join(dir, ".vscode", "settings.json"), "utf-8"));
    expect(settings["files.exclude"]).toEqual({ "**/*.map": true, ".vscode/extensions": true });
    expect(settings["cortex-debug.openocdConfigFiles"]).toEqual(["openocd.cfg"]);
  });

  it("still writes the extensions and extensions.json", () => {
    const dir = makeProject();
    const written = writeEditorIntegration(dir, undefined, true);
    expect(fs.existsSync(path.join(dir, ".vscode", "extensions", "typecad-ui", "package.json"))).toBe(true);
    const forceInstall = JSON.parse(fs.readFileSync(path.join(dir, ".vscode", "extensions.json"), "utf-8")).forceInstall;
    expect(forceInstall).toContain("typecad.typecad-ui");
    expect(forceInstall).toContain("typecad.vscode-typecad-debug");
    expect(forceInstall).toContain("typecad.vscode-typecad-intel");
    expect(written.length).toBeGreaterThan(0);
  });
});
