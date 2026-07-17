import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  runLicensesPresenter,
  __setLicensesRunnerForTest,
  __setProjectConfigForTest,
} from "../../../packages/cuttlefish/src/licenses";

// The presenter lives in licenses.ts (not cli.ts) so it is importable from
// tests without tripping cli.ts's shebang or top-level main() call.

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
    __setProjectConfigForTest(undefined);
    logSpy.mockRestore();
    process.exitCode = exitCode;
  });

  function output(): string {
    return logSpy.mock.calls.map((c) => c.join(" ")).join("\n");
  }

  it("prints a green table and exits 0 when all licenses are known", () => {
    __setLicensesRunnerForTest({
      listLibraries: () => [{ name: "Adafruit_GFX", version: "1.11.5", install_dir: "/GFX" }],
      readFile: (p) => (p.endsWith("library.properties") ? "license=BSD-3-Clause\n" : undefined),
      readdir: () => ["library.properties"],
    });
    runLicensesPresenter(false, true);
    expect(output()).toContain("BSD-3-Clause");
    expect(output()).toContain("Adafruit_GFX");
    expect(process.exitCode).toBeUndefined(); // exit 0
  });

  it("warns on unknowns and exits 0 without --strict", () => {
    __setLicensesRunnerForTest({
      listLibraries: () => [{ name: "OneWire", install_dir: "/OW" }],
      readFile: () => undefined,
      readdir: () => [],
    });
    runLicensesPresenter(false, true);
    expect(output()).toContain("UNKNOWN");
    expect(process.exitCode).toBeUndefined(); // exit 0
  });

  it("exits 1 on unknowns when --strict is set", () => {
    __setLicensesRunnerForTest({
      listLibraries: () => [{ name: "OneWire", install_dir: "/OW" }],
      readFile: () => undefined,
      readdir: () => [],
    });
    runLicensesPresenter(true, true);
    expect(output()).toContain("UNKNOWN");
    expect(process.exitCode).toBe(1);
  });

  it("exits 1 with a red error when arduino-cli is unresponsive", () => {
    __setLicensesRunnerForTest({
      listLibraries: () => null,
      readFile: () => undefined,
      readdir: () => [],
    });
    runLicensesPresenter(false, true);
    expect(process.exitCode).toBe(1);
  });

  it("exits 0 with an informational message when no libraries are installed", () => {
    __setLicensesRunnerForTest({
      listLibraries: () => [],
      readFile: () => undefined,
      readdir: () => [],
    });
    runLicensesPresenter(false, true);
    expect(output()).toContain("no libraries installed");
    expect(process.exitCode).toBeUndefined(); // exit 0
  });

  it("uses the correct singular 'library' in the unknowns block for one unknown", () => {
    __setLicensesRunnerForTest({
      listLibraries: () => [{ name: "Solo", install_dir: "/Solo" }],
      readFile: () => undefined,
      readdir: () => [],
    });
    runLicensesPresenter(false, true);
    expect(output()).toContain("1 library:");
    expect(output()).not.toContain("libraryies");
    expect(output()).not.toContain("1 libraries");
  });
});

describe("runLicensesPresenter — project scope", () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  let exitCode: number | string | undefined;

  beforeEach(() => {
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    exitCode = process.exitCode;
    process.exitCode = undefined;
  });

  afterEach(() => {
    __setLicensesRunnerForTest(undefined);
    __setProjectConfigForTest(undefined);
    logSpy.mockRestore();
    process.exitCode = exitCode;
  });

  function output(): string {
    return logSpy.mock.calls.map((c) => c.join(" ")).join("\n");
  }

  it("renders resolved project libs and names the .ino in the scope label", () => {
    __setProjectConfigForTest({
      configPath: "/proj/cuttlefish.config.ts",
      entry: "./src/main.ts",
      outputOutDir: "./out",
    });
    __setLicensesRunnerForTest({
      // The .ino read + the lib-dir reads both go through readFile.
      listLibraries: () => [{ name: "Adafruit ILI9341", version: "1.6.0", install_dir: "/ILI9341" }],
      readFile: (p) => {
        if (p.endsWith("main.ino")) return "#include <Adafruit_ILI9341.h>\n#include <Arduino.h>\n";
        if (p.endsWith("library.properties")) return "license=BSD-3-Clause\n";
        return undefined;
      },
      readdir: (d) => (d.endsWith("ILI9341") ? ["Adafruit_ILI9341.h", "library.properties"] : []),
    });
    runLicensesPresenter(false, false);
    expect(output()).toContain("Adafruit ILI9341");
    expect(output()).toContain("BSD-3-Clause");
    expect(output()).toMatch(/main\.ino/);
    expect(process.exitCode).toBeUndefined();
  });

  it("flags NOT INSTALLED headers in project scope (exit 0 without --strict)", () => {
    __setProjectConfigForTest({
      configPath: "/proj/cuttlefish.config.ts",
      entry: "./src/main.ts",
      outputOutDir: "./out",
    });
    __setLicensesRunnerForTest({
      listLibraries: () => [],
      readFile: (p) => (p.endsWith("main.ino") ? "#include <Adafruit_ST7796S.h>\n" : undefined),
      readdir: () => [],
    });
    runLicensesPresenter(false, false);
    expect(output()).toContain("NOT INSTALLED");
    expect(output()).toContain("Adafruit_ST7796S.h");
    expect(process.exitCode).toBeUndefined();
  });

  it("exits 1 on NOT INSTALLED under --strict (project scope)", () => {
    __setProjectConfigForTest({
      configPath: "/proj/cuttlefish.config.ts",
      entry: "./src/main.ts",
      outputOutDir: "./out",
    });
    __setLicensesRunnerForTest({
      listLibraries: () => [],
      readFile: (p) => (p.endsWith("main.ino") ? "#include <Adafruit_ST7796S.h>\n" : undefined),
      readdir: () => [],
    });
    runLicensesPresenter(true, false);
    expect(process.exitCode).toBe(1);
  });

  it("prints an informational message and exits 0 when there is no config (project scope)", () => {
    __setProjectConfigForTest(undefined);
    __setLicensesRunnerForTest({
      listLibraries: () => [],
      readFile: () => undefined,
      readdir: () => [],
    });
    runLicensesPresenter(false, false);
    expect(output()).toContain("cuttlefish.config.ts");
    expect(process.exitCode).toBeUndefined();
  });

  it("--all scope behaves as before (no NOT INSTALLED concept)", () => {
    __setProjectConfigForTest(undefined); // ignored under --all
    __setLicensesRunnerForTest({
      listLibraries: () => [{ name: "ArduinoJson", version: "6.21", install_dir: "/AJ" }],
      readFile: (p) => (p.endsWith("library.properties") ? "license=MIT\n" : undefined),
      readdir: (d) => (d.endsWith("AJ") ? ["library.properties"] : []),
    });
    runLicensesPresenter(false, true);
    expect(output()).toContain("all installed");
    expect(output()).toContain("ArduinoJson");
    expect(output()).not.toContain("NOT INSTALLED");
    expect(process.exitCode).toBeUndefined();
  });
});
