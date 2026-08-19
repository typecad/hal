// Unit tests for the create-time framework debug-artifact helper
// (cuttlefish src/create/debug-artifacts.ts). The framework module loader is
// injected, so these cover the core wiring — optionality, pass-through, and
// failure tolerance — without needing a real framework package on disk.

import { describe, it, expect, vi, afterEach } from "vitest";
import { generateFrameworkDebugArtifacts } from "../../../packages/cuttlefish/src/create/debug-artifacts";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("generateFrameworkDebugArtifacts", () => {
  it("returns [] when no framework package or workspace root is given", () => {
    const loader = vi.fn();
    expect(generateFrameworkDebugArtifacts({ workspaceRoot: "/tmp/proj" }, loader)).toEqual([]);
    expect(generateFrameworkDebugArtifacts({ frameworkPackage: "@typecad/framework-zephyr" }, loader)).toEqual([]);
    expect(loader).not.toHaveBeenCalled();
  });

  it("returns [] when the framework package cannot be resolved", () => {
    // E.g. `cuttlefish create --no-install` before npm install — silent
    // skip; the first --debug build writes the artifacts anyway.
    expect(
      generateFrameworkDebugArtifacts(
        { frameworkPackage: "@typecad/framework-zephyr", workspaceRoot: "/tmp/proj" },
        () => undefined,
      ),
    ).toEqual([]);
  });

  it("returns [] when the loader itself throws", () => {
    expect(
      generateFrameworkDebugArtifacts(
        { frameworkPackage: "@typecad/framework-zephyr", workspaceRoot: "/tmp/proj" },
        () => {
          throw new Error("ENOENT");
        },
      ),
    ).toEqual([]);
  });

  it("returns [] when the framework has no writeProjectDebugArtifacts export", () => {
    // Frameworks without native debug support (e.g. framework-arduino) simply
    // don't export the hook — this must be a no-op, not an error.
    expect(
      generateFrameworkDebugArtifacts(
        { frameworkPackage: "@typecad/framework-arduino", workspaceRoot: "/tmp/proj" },
        () => ({ FrameworkStrategy: class {} }),
      ),
    ).toEqual([]);
  });

  it("passes workspaceRoot + buildTarget through and returns the written paths", () => {
    const writeProjectDebugArtifacts = vi.fn(() => [".vscode/launch.json", ".vscode/tasks.json"]);
    const loader = vi.fn(() => ({ writeProjectDebugArtifacts }));

    const written = generateFrameworkDebugArtifacts(
      {
        frameworkPackage: "@typecad/framework-zephyr",
        workspaceRoot: "C:/proj",
        buildTarget: "esp32s3_devkitc/esp32s3/procpu",
      },
      loader,
    );

    expect(loader).toHaveBeenCalledWith("@typecad/framework-zephyr");
    expect(writeProjectDebugArtifacts).toHaveBeenCalledWith({
      workspaceRoot: "C:/proj",
      buildTarget: "esp32s3_devkitc/esp32s3/procpu",
    });
    expect(written).toEqual([".vscode/launch.json", ".vscode/tasks.json"]);
  });

  it("tolerates a non-array return from the framework hook", () => {
    expect(
      generateFrameworkDebugArtifacts(
        { frameworkPackage: "@typecad/framework-zephyr", workspaceRoot: "/tmp/proj" },
        () => ({ writeProjectDebugArtifacts: () => undefined }),
      ),
    ).toEqual([]);
  });

  it("warns and returns [] when the framework hook throws (never fails create)", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(
      generateFrameworkDebugArtifacts(
        { frameworkPackage: "@typecad/framework-zephyr", workspaceRoot: "/tmp/proj" },
        () => ({
          writeProjectDebugArtifacts: () => {
            throw new Error("disk on fire");
          },
        }),
      ),
    ).toEqual([]);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("disk on fire"));
  });
});
