import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  runLicensesPresenter,
  __setLicensesRunnerForTest,
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
    runLicensesPresenter(false);
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
    runLicensesPresenter(false);
    expect(output()).toContain("UNKNOWN");
    expect(process.exitCode).toBeUndefined(); // exit 0
  });

  it("exits 1 on unknowns when --strict is set", () => {
    __setLicensesRunnerForTest({
      listLibraries: () => [{ name: "OneWire", install_dir: "/OW" }],
      readFile: () => undefined,
      readdir: () => [],
    });
    runLicensesPresenter(true);
    expect(output()).toContain("UNKNOWN");
    expect(process.exitCode).toBe(1);
  });

  it("exits 1 with a red error when arduino-cli is unresponsive", () => {
    __setLicensesRunnerForTest({
      listLibraries: () => null,
      readFile: () => undefined,
      readdir: () => [],
    });
    runLicensesPresenter(false);
    expect(process.exitCode).toBe(1);
  });

  it("exits 0 with an informational message when no libraries are installed", () => {
    __setLicensesRunnerForTest({
      listLibraries: () => [],
      readFile: () => undefined,
      readdir: () => [],
    });
    runLicensesPresenter(false);
    expect(output()).toContain("no libraries installed");
    expect(process.exitCode).toBeUndefined(); // exit 0
  });

  it("uses the correct singular 'library' in the unknowns block for one unknown", () => {
    __setLicensesRunnerForTest({
      listLibraries: () => [{ name: "Solo", install_dir: "/Solo" }],
      readFile: () => undefined,
      readdir: () => [],
    });
    runLicensesPresenter(false);
    expect(output()).toContain("1 library:");
    expect(output()).not.toContain("libraryies");
    expect(output()).not.toContain("1 libraries");
  });
});
