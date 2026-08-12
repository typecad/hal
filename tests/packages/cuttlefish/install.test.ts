import { describe, it, expect, vi, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

import { parseCommandLine } from "../../../packages/cuttlefish/src/utils/cli";
import {
  FRAMEWORK_CATALOG,
  frameworkCatalogEntry,
  frameworksForTarget,
  detectPackageManager,
  buildInstallCommand,
} from "../../../packages/cuttlefish/src/install/framework-catalog";
import {
  installFrameworkPackage,
  handleInstall,
  __setInstallRunnerForTest,
} from "../../../packages/cuttlefish/src/install/handle-install";

afterEach(() => {
  // Restore the real spawn-based installer between tests so module state never
  // leaks across cases.
  __setInstallRunnerForTest(undefined);
  vi.restoreAllMocks();
});

// ── parser ──────────────────────────────────────────────────────────────────

describe("parseCommandLine: install", () => {
  it("parses bare 'install' with no framework/board", () => {
    const opts = parseCommandLine(["node", "cuttlefish", "install"]);
    // dryRun mirrors create's noSketch: argv.includes(...) → boolean (false when absent).
    expect(opts).toMatchObject({ command: "install", framework: undefined, board: undefined, dryRun: false });
  });

  it("accepts a positional framework id", () => {
    const opts = parseCommandLine(["node", "cuttlefish", "install", "arduino"]);
    expect(opts).toMatchObject({ command: "install", framework: "arduino" });
  });

  it("accepts --framework / -f", () => {
    expect(parseCommandLine(["node", "cuttlefish", "install", "--framework", "zephyr"])).toMatchObject({
      command: "install",
      framework: "zephyr",
    });
    expect(parseCommandLine(["node", "cuttlefish", "install", "-f", "zephyr"])).toMatchObject({
      framework: "zephyr",
    });
  });

  it("accepts --board / -b to narrow the framework prompt", () => {
    const opts = parseCommandLine(["node", "cuttlefish", "install", "--board", "esp32-devkit"]);
    expect(opts).toMatchObject({ command: "install", board: "esp32-devkit", framework: undefined });
  });

  it("accepts --dry-run", () => {
    expect(parseCommandLine(["node", "cuttlefish", "install", "--dry-run"])).toMatchObject({ dryRun: true });
    expect(parseCommandLine(["node", "cuttlefish", "install", "arduino", "--dry-run"])).toMatchObject({
      framework: "arduino",
      dryRun: true,
    });
  });

  it("does not treat a leading-dash positional as a framework", () => {
    // `cuttlefish install --board x` must not swallow --board as the framework.
    const opts = parseCommandLine(["node", "cuttlefish", "install", "--board", "esp32-devkit"]);
    expect((opts as { framework?: string }).framework).toBeUndefined();
  });
});

// ── board → framework narrowing ─────────────────────────────────────────────

describe("frameworksForTarget", () => {
  it("narrows esp32 to arduino + zephyr (both claim it)", () => {
    expect(frameworksForTarget({ architecture: "esp32" }).map((f) => f.id)).toEqual(["arduino", "zephyr"]);
  });

  it("narrows esp32s3 to arduino + zephyr", () => {
    expect(frameworksForTarget({ architecture: "esp32s3" }).map((f) => f.id)).toEqual(["arduino", "zephyr"]);
  });

  it("narrows avr / esp32c3 / esp32c6 / rp2040 / rp2350 to arduino only", () => {
    for (const arch of ["avr", "esp32c3", "esp32c6", "rp2040", "rp2350"]) {
      expect(frameworksForTarget({ architecture: arch }).map((f) => f.id)).toEqual(["arduino"]);
    }
  });

  it("maps native boards to [native]", () => {
    expect(frameworksForTarget({ isNative: true }).map((f) => f.id)).toEqual(["native"]);
  });

  it("maps nrf52 to [zephyr]", () => {
    expect(frameworksForTarget({ architecture: "nrf52" }).map((f) => f.id)).toEqual(["zephyr"]);
  });

  it("falls back to [arduino] for an unknown architecture", () => {
    expect(frameworksForTarget({ architecture: "totally-unknown-mcu" }).map((f) => f.id)).toEqual(["arduino"]);
  });

  it("only returns catalog entries flagged installable", () => {
    // Every entry the catalog ever returns for a real board must be installable.
    const all = frameworksForTarget({ architecture: "esp32" });
    expect(all.every((f) => f.installable)).toBe(true);
    expect(FRAMEWORK_CATALOG.every((f) => f.installable)).toBe(true);
  });
});

describe("frameworkCatalogEntry", () => {
  it("resolves a known id", () => {
    expect(frameworkCatalogEntry("arduino")?.packageName).toBe("@typecad/framework-arduino");
  });
  it("returns undefined for an unknown id", () => {
    expect(frameworkCatalogEntry("nope")).toBeUndefined();
  });
});

// ── package-manager detection ───────────────────────────────────────────────

function makeTempDir(seed?: Record<string, string>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cuttlefish-install-"));
  if (seed) {
    for (const [name, contents] of Object.entries(seed)) {
      fs.writeFileSync(path.join(dir, name), contents);
    }
  }
  return dir;
}

describe("detectPackageManager", () => {
  it("honors package.json#packageManager (pnpm)", () => {
    const dir = makeTempDir({ "package.json": JSON.stringify({ packageManager: "pnpm@9.12.0" }) });
    expect(detectPackageManager(dir)).toBe("pnpm");
  });

  it("honors package.json#packageManager (yarn)", () => {
    const dir = makeTempDir({ "package.json": JSON.stringify({ packageManager: "yarn@4.0.0" }) });
    expect(detectPackageManager(dir)).toBe("yarn");
  });

  it("honors package.json#packageManager (npm)", () => {
    const dir = makeTempDir({ "package.json": JSON.stringify({ packageManager: "npm@10.8.0" }) });
    expect(detectPackageManager(dir)).toBe("npm");
  });

  it("falls back to lockfile presence", () => {
    expect(detectPackageManager(makeTempDir({ "pnpm-lock.yaml": "" }))).toBe("pnpm");
    expect(detectPackageManager(makeTempDir({ "yarn.lock": "" }))).toBe("yarn");
    expect(detectPackageManager(makeTempDir({ "package-lock.json": "{}" }))).toBe("npm");
  });

  it("defaults to npm when there are no signals", () => {
    expect(detectPackageManager(makeTempDir())).toBe("npm");
  });

  it("does not throw on an unparseable package.json", () => {
    const dir = makeTempDir({ "package.json": "{ not valid json" });
    expect(detectPackageManager(dir)).toBe("npm");
  });
});

describe("buildInstallCommand", () => {
  const pkg = "@typecad/framework-arduino";
  it("npm → npm install <pkg>", () => {
    expect(buildInstallCommand("npm", pkg)).toEqual({ bin: "npm", args: ["install", pkg] });
  });
  it("pnpm → pnpm add <pkg>", () => {
    expect(buildInstallCommand("pnpm", pkg)).toEqual({ bin: "pnpm", args: ["add", pkg] });
  });
  it("yarn → yarn add <pkg>", () => {
    expect(buildInstallCommand("yarn", pkg)).toEqual({ bin: "yarn", args: ["add", pkg] });
  });
});

// ── installFrameworkPackage (spawn, via the test runner hook) ───────────────

describe("installFrameworkPackage", () => {
  it("invokes the detected package manager with the framework package", () => {
    const dir = makeTempDir({ "package.json": JSON.stringify({ packageManager: "pnpm@9.0.0" }) });
    const seen: Array<{ bin: string; args: string[] }> = [];
    __setInstallRunnerForTest((cmd) => {
      seen.push({ bin: cmd.bin, args: cmd.args });
      return { status: 0 };
    });

    const result = installFrameworkPackage(frameworkCatalogEntry("arduino")!, { cwd: dir });

    expect(seen).toEqual([{ bin: "pnpm", args: ["add", "@typecad/framework-arduino"] }]);
    expect(result.pm).toBe("pnpm");
  });

  it("throws on non-zero exit status", () => {
    const dir = makeTempDir();
    __setInstallRunnerForTest(() => ({ status: 1 }));
    expect(() =>
      installFrameworkPackage(frameworkCatalogEntry("arduino")!, { cwd: dir }),
    ).toThrowError(/exited with code 1/);
  });

  it("throws on launch failure (e.g. binary missing)", () => {
    const dir = makeTempDir();
    __setInstallRunnerForTest(() => ({ status: null, launchError: "'npm' not found on PATH" }));
    expect(() =>
      installFrameworkPackage(frameworkCatalogEntry("arduino")!, { cwd: dir }),
    ).toThrowError(/not found on PATH/);
  });

  it("does not spawn in dry-run mode", () => {
    const dir = makeTempDir();
    let called = false;
    __setInstallRunnerForTest(() => {
      called = true;
      return { status: 0 };
    });

    const result = installFrameworkPackage(frameworkCatalogEntry("arduino")!, { cwd: dir, dryRun: true });

    expect(called).toBe(false);
    expect(result).toMatchObject({ bin: "npm", args: ["install", "@typecad/framework-arduino"] });
  });
});

// ── handleInstall (end-to-end, framework given so no TTY is needed) ─────────

describe("handleInstall", () => {
  it("rejects an unknown framework id", async () => {
    await expect(handleInstall({ command: "install", framework: "nope" })).rejects.toThrowError(
      /Unknown framework 'nope'/,
    );
  });

  it("dry-run prints the resolved command and installs nothing", async () => {
    const dir = makeTempDir();
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    let called = false;
    __setInstallRunnerForTest(() => {
      called = true;
      return { status: 0 };
    });

    const originalCwd = process.cwd();
    process.chdir(dir);
    try {
      await handleInstall({ command: "install", framework: "arduino", dryRun: true });
    } finally {
      process.chdir(originalCwd);
    }

    expect(called).toBe(false);
    const printed = logSpy.mock.calls.map((c) => c.join(" ")).join("\n");
    expect(printed).toContain("npm install @typecad/framework-arduino");
    expect(printed).toContain("dry-run");
  });

  it("auto-selects the single compatible framework for --board (no prompt, no TTY)", async () => {
    // arduino-uno (avr) → only arduino. No framework given, but no prompt is
    // needed, so this works under non-interactive stdin.
    const dir = makeTempDir();
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const seen: Array<{ bin: string; args: string[] }> = [];
    __setInstallRunnerForTest((cmd) => {
      seen.push({ bin: cmd.bin, args: cmd.args });
      return { status: 0 };
    });

    const originalCwd = process.cwd();
    process.chdir(dir);
    try {
      await handleInstall({ command: "install", board: "arduino-uno" });
    } finally {
      process.chdir(originalCwd);
    }

    expect(seen).toEqual([{ bin: "npm", args: ["install", "@typecad/framework-arduino"] }]);
    const printed = logSpy.mock.calls.map((c) => c.join(" ")).join("\n");
    expect(printed).toContain("only option for arduino-uno");
  });

  it("rejects an unknown board id", async () => {
    await expect(handleInstall({ command: "install", board: "nope" })).rejects.toThrowError(
      /Unknown board 'nope'/,
    );
  });

  it("rejects a bare install under non-interactive stdin", async () => {
    // Vitest pipes stdin (not a TTY), so the guard should fire rather than hang.
    await expect(handleInstall({ command: "install" })).rejects.toThrowError(
      /stdin is not interactive/,
    );
  });
});
