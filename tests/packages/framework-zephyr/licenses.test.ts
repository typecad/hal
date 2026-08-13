import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  scanZephyrLicenses,
  runLicensesPresenter,
  __setLicensesRunnerForTest,
  type ZephyrLicensesRunner,
} from "../../../packages/framework-zephyr/src/licenses";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const fsStub = (files: Record<string, string>): { readFile: ZephyrLicensesRunner["readFile"]; readdir: ZephyrLicensesRunner["readdir"] } => {
  const norm = (p: string) => p.replace(/\\/g, "/").replace(/\/+$/, "");
  const readFile: ZephyrLicensesRunner["readFile"] = (p) => {
    const n = norm(p);
    if (files[n] !== undefined) return files[n];
    const base = n.split("/").pop();
    const hit = Object.entries(files).find(([k]) => norm(k).split("/").pop() === base);
    return hit ? hit[1] : undefined;
  };
  const readdir: ZephyrLicensesRunner["readdir"] = (d) => {
    const nd = norm(d);
    const children = new Set<string>();
    for (const k of Object.keys(files)) {
      const nk = norm(k);
      if (nk.startsWith(nd + "/")) {
        const rest = nk.slice(nd.length + 1);
        const first = rest.split("/")[0];
        if (first) children.add(first);
      }
    }
    return [...children];
  };
  return { readFile, readdir };
};

/** Build a compile_commands.json text that "compiled" one source under each
 *  given module abspath — so those modules register as linked. */
function ccJsonFor(abspaths: string[]): string {
  return JSON.stringify(abspaths.map((p) => ({ file: `${p.replace(/\\/g, "/")}/src/compiled.c` })));
}

const KERNEL = { "/zephyr/LICENSE": "Apache License\nVersion 2.0" };
const MIT = { "/mods/mit/LICENSE": "MIT licence\nPermission is hereby granted, free of charge" };
const GPL = { "/mods/gpl/LICENSE": "GNU GENERAL PUBLIC LICENSE\nVersion 3" };

// ---------------------------------------------------------------------------
// scanZephyrLicenses — --all scope (every manifest module)
// ---------------------------------------------------------------------------

describe("scanZephyrLicenses — --all scope", () => {
  it("includes the kernel + every west module, sorted worst-first", () => {
    const { readFile, readdir } = fsStub({ ...KERNEL, ...MIT, ...GPL });
    const runner: ZephyrLicensesRunner = {
      topdir: () => "/ws",
      listModules: () => [
        { name: "mit-lib", abspath: "/mods/mit" },
        { name: "gpl-lib", abspath: "/mods/gpl" },
      ],
      zephyrBase: "/zephyr",
      readFile,
      readdir,
    };
    const result = scanZephyrLicenses(runner, true);
    expect(result.ok).toBe(true);
    if (result.ok) {
      // strong-copyleft (gpl) → permissive alphabetical (mit before kernel).
      expect(result.entries.map((e) => e.name)).toEqual(["gpl-lib", "mit-lib", "zephyr (kernel)"]);
      expect(result.entries.find((e) => e.name === "zephyr (kernel)")?.spdx).toBe("Apache-2.0");
    }
  });

  it("skips the kernel module when it also appears in west list (no duplicate)", () => {
    const { readFile, readdir } = fsStub(KERNEL);
    const runner: ZephyrLicensesRunner = {
      topdir: () => "/ws",
      listModules: () => [{ name: "zephyr", abspath: "/zephyr" }],
      zephyrBase: "/zephyr",
      readFile,
      readdir,
    };
    const result = scanZephyrLicenses(runner, true);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.entries.filter((e) => e.name === "zephyr (kernel)")).toHaveLength(1);
    }
  });
});

// ---------------------------------------------------------------------------
// scanZephyrLicenses — project scope (linked modules only)
// ---------------------------------------------------------------------------

describe("scanZephyrLicenses — project scope (linked only)", () => {
  it("lists only modules whose sources were compiled (kernel + linked)", () => {
    const { readFile, readdir } = fsStub({ ...KERNEL, ...MIT, ...GPL });
    const runner: ZephyrLicensesRunner = {
      topdir: () => "/ws",
      listModules: () => [
        { name: "mit-lib", abspath: "/mods/mit" },
        { name: "gpl-lib", abspath: "/mods/gpl" },
      ],
      zephyrBase: "/zephyr",
      // Only mit-lib was compiled → gpl-lib is unused and must be filtered out.
      compileCommands: () => ccJsonFor(["/mods/mit"]),
      readFile,
      readdir,
    };
    const result = scanZephyrLicenses(runner); // default scope = project
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.entries.map((e) => e.name)).toEqual(["mit-lib", "zephyr (kernel)"]);
      expect(result.needsBuild).toBeFalsy();
    }
  });

  it("reports kernel-only + needsBuild when no build exists", () => {
    const { readFile, readdir } = fsStub({ ...KERNEL, ...MIT });
    const runner: ZephyrLicensesRunner = {
      topdir: () => "/ws",
      listModules: () => [{ name: "mit-lib", abspath: "/mods/mit" }],
      zephyrBase: "/zephyr",
      compileCommands: () => null, // no build
      readFile,
      readdir,
    };
    const result = scanZephyrLicenses(runner);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.needsBuild).toBe(true);
      expect(result.entries.map((e) => e.name)).toEqual(["zephyr (kernel)"]);
    }
  });

  it("matches module abspaths case/separator-insensitively", () => {
    const { readFile, readdir } = fsStub({ ...KERNEL, ...MIT });
    const runner: ZephyrLicensesRunner = {
      topdir: () => "/ws",
      listModules: () => [{ name: "mit-lib", abspath: "C:\\Users\\me\\modules\\hal\\mit" }],
      zephyrBase: "/zephyr",
      // cc.json uses forward slashes + the same path → must still match.
      compileCommands: () => ccJsonFor(["C:/Users/me/modules/hal/mit"]),
      readFile,
      readdir,
    };
    const result = scanZephyrLicenses(runner);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.entries.map((e) => e.name)).toContain("mit-lib");
    }
  });

  it("finds a module LICENSE under its zephyr/ subdir (e.g. hal_nordic)", () => {
    // Nordic's module ships zephyr/LICENSE.txt — the resolver must check the
    // zephyr/ and src/ subdirs, not just the module root.
    const { readFile, readdir } = fsStub({
      ...KERNEL,
      "/mods/nordic/zephyr/LICENSE.txt": "BSD license, all text here must be included",
    });
    const runner: ZephyrLicensesRunner = {
      topdir: () => "/ws",
      listModules: () => [{ name: "hal_nordic", abspath: "/mods/nordic" }],
      zephyrBase: "/zephyr",
      compileCommands: () => ccJsonFor(["/mods/nordic"]),
      readFile,
      readdir,
    };
    const result = scanZephyrLicenses(runner);
    expect(result.ok).toBe(true);
    if (result.ok) {
      const nordic = result.entries.find((e) => e.name === "hal_nordic");
      expect(nordic?.spdx).toBe("BSD-3-Clause");
    }
  });
});

// ---------------------------------------------------------------------------
// scanZephyrLicenses — failure modes
// ---------------------------------------------------------------------------

describe("scanZephyrLicenses — failure modes", () => {
  it("fails with no-workspace when west list fails and no kernel is known", () => {
    const runner: ZephyrLicensesRunner = {
      topdir: () => null,
      listModules: () => null,
      readFile: () => undefined,
      readdir: () => [],
    };
    const result = scanZephyrLicenses(runner);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("no-workspace");
  });

  it("fails with no-dependencies when both kernel and module list are empty", () => {
    const runner: ZephyrLicensesRunner = {
      topdir: () => "/ws",
      listModules: () => [],
      readFile: () => undefined,
      readdir: () => [],
    };
    const result = scanZephyrLicenses(runner);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("no-dependencies");
  });
});

// ---------------------------------------------------------------------------
// runLicensesPresenter — rendering + exit code (console.log spied)
// ---------------------------------------------------------------------------

describe("runLicensesPresenter — presenter", () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  let exitCode: number | string | undefined;

  beforeEach(() => {
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    exitCode = process.exitCode;
    process.exitCode = undefined;
  });

  afterEach(() => {
    __setLicensesRunnerForTest(undefined);
    logSpy.mockRestore();
    process.exitCode = exitCode;
  });

  function output(): string {
    return logSpy.mock.calls.map((c) => c.join(" ")).join("\n");
  }

  it("project scope lists only linked modules and exits 0 when permissive", () => {
    const { readFile, readdir } = fsStub({ ...KERNEL, ...MIT });
    __setLicensesRunnerForTest({
      topdir: () => "/ws",
      listModules: () => [{ name: "mit-lib", abspath: "/mods/mit" }],
      zephyrBase: "/zephyr",
      compileCommands: () => ccJsonFor(["/mods/mit"]),
      readFile,
      readdir,
    });
    runLicensesPresenter(false, false);
    expect(output()).toContain("Apache-2.0");
    expect(output()).toContain("MIT");
    expect(process.exitCode).toBeUndefined();
  });

  it("--all lists every manifest module", () => {
    const { readFile, readdir } = fsStub({ ...KERNEL, ...MIT, ...GPL });
    __setLicensesRunnerForTest({
      topdir: () => "/ws",
      listModules: () => [
        { name: "mit-lib", abspath: "/mods/mit" },
        { name: "gpl-lib", abspath: "/mods/gpl" },
      ],
      zephyrBase: "/zephyr",
      readFile,
      readdir,
    });
    runLicensesPresenter(false, true);
    expect(output()).toContain("GPL-3.0");
    expect(output()).toContain("MIT");
  });

  it("warns on strong-copyleft and exits 1 under --strict", () => {
    const { readFile, readdir } = fsStub({ ...KERNEL, ...GPL });
    __setLicensesRunnerForTest({
      topdir: () => "/ws",
      listModules: () => [{ name: "gpl-lib", abspath: "/mods/gpl" }],
      zephyrBase: "/zephyr",
      compileCommands: () => ccJsonFor(["/mods/gpl"]),
      readFile,
      readdir,
    });
    runLicensesPresenter(true, false);
    expect(output()).toContain("GPL-3.0");
    expect(output()).toContain("strong-copyleft");
    expect(process.exitCode).toBe(1);
  });

  it("prints a build-first hint when no build is found (project scope)", () => {
    const { readFile, readdir } = fsStub(KERNEL);
    __setLicensesRunnerForTest({
      topdir: () => "/ws",
      listModules: () => [{ name: "mit-lib", abspath: "/mods/mit" }],
      zephyrBase: "/zephyr",
      compileCommands: () => null,
      readFile,
      readdir,
    });
    runLicensesPresenter(false, false);
    expect(output()).toContain("no build found");
    expect(output()).toContain("zephyr (kernel)"); // kernel still shown
  });

  it("reports west NOT FOUND and exits 1 when no west install is discovered", () => {
    __setLicensesRunnerForTest(null);
    runLicensesPresenter(false, false);
    expect(output()).toContain("NOT FOUND");
    expect(process.exitCode).toBe(1);
  });
});
