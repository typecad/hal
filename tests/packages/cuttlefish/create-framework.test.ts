import { describe, it, expect, vi, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

import {
  FRAMEWORK_CATALOG,
  frameworkCatalogEntry,
  frameworksForTarget,
  frameworkCompatibleWithTarget,
  detectPackageManager,
  frameworkTargetProfile,
  BOARD_PROBE_METHODS,
} from "../../../packages/cuttlefish/src/create/framework-catalog";
import {
  installProjectDependencies,
  __setProjectInstallRunnerForTest,
} from "../../../packages/cuttlefish/src/create/install-deps";

afterEach(() => {
  __setProjectInstallRunnerForTest(undefined);
  vi.restoreAllMocks();
});

// ── board → framework narrowing (used by the create wizard) ─────────────────

describe("frameworksForTarget", () => {
  it("narrows esp32 to arduino + zephyr", () => {
    expect(frameworksForTarget({ architecture: "esp32" }).map((f) => f.id)).toEqual(["arduino", "zephyr"]);
  });

  it("narrows esp32s3 to arduino + zephyr", () => {
    expect(frameworksForTarget({ architecture: "esp32s3" }).map((f) => f.id)).toEqual(["arduino", "zephyr"]);
  });

  it("narrows esp32c3 / esp32c6 to arduino + zephyr", () => {
    for (const arch of ["esp32c3", "esp32c6"]) {
      expect(frameworksForTarget({ architecture: arch }).map((f) => f.id)).toEqual(["arduino", "zephyr"]);
    }
  });

  it("narrows avr / rp2040 / rp2350 to arduino only", () => {
    for (const arch of ["avr", "rp2040", "rp2350"]) {
      expect(frameworksForTarget({ architecture: arch }).map((f) => f.id)).toEqual(["arduino"]);
    }
  });

  it("maps native boards to [native]", () => {
    expect(frameworksForTarget({ isNative: true }).map((f) => f.id)).toEqual(["native"]);
  });

  it("maps nrf52 to [zephyr]", () => {
    expect(frameworksForTarget({ architecture: "nrf52" }).map((f) => f.id)).toEqual(["zephyr"]);
  });

  it("maps stm32f411 to [zephyr] (Black Pill is Zephyr-only; generic stm32 stays arduino)", () => {
    expect(frameworksForTarget({ architecture: "stm32f411" }).map((f) => f.id)).toEqual(["zephyr"]);
    expect(frameworksForTarget({ architecture: "stm32" }).map((f) => f.id)).toEqual(["arduino"]);
  });

  it("falls back to [arduino] for an unknown architecture", () => {
    expect(frameworksForTarget({ architecture: "totally-unknown-mcu" }).map((f) => f.id)).toEqual(["arduino"]);
  });

  it("only returns installable catalog entries", () => {
    expect(FRAMEWORK_CATALOG.every((f) => f.installable)).toBe(true);
    expect(frameworksForTarget({ architecture: "esp32" }).every((f) => f.installable)).toBe(true);
  });
});

describe("frameworkCatalogEntry", () => {
  it("resolves a known id to its package name", () => {
    expect(frameworkCatalogEntry("zephyr")?.packageName).toBe("@typecad/framework-zephyr");
  });
  it("returns undefined for an unknown id", () => {
    expect(frameworkCatalogEntry("nope")).toBeUndefined();
  });
});

// ── explicit --framework validation (guard: an explicit request bypasses the
// auto-pick narrowing, so incompatible pairs must be rejectable). ────────────

describe("frameworkCompatibleWithTarget", () => {
  it("accepts zephyr for nrf52 and rejects arduino (Zephyr-only board)", () => {
    expect(frameworkCompatibleWithTarget({ architecture: "nrf52" }, "zephyr")).toBe(true);
    expect(frameworkCompatibleWithTarget({ architecture: "nrf52" }, "arduino")).toBe(false);
  });

  it("accepts both arduino and zephyr for multi-framework architectures", () => {
    for (const arch of ["esp32", "esp32s3"]) {
      expect(frameworkCompatibleWithTarget({ architecture: arch }, "arduino")).toBe(true);
      expect(frameworkCompatibleWithTarget({ architecture: arch }, "zephyr")).toBe(true);
    }
  });

  it("keeps native and embedded frameworks disjoint", () => {
    expect(frameworkCompatibleWithTarget({ architecture: "esp32s3" }, "native")).toBe(false);
    expect(frameworkCompatibleWithTarget({ isNative: true }, "arduino")).toBe(false);
    expect(frameworkCompatibleWithTarget({ isNative: true }, "zephyr")).toBe(false);
    expect(frameworkCompatibleWithTarget({ isNative: true }, "native")).toBe(true);
  });

  it("returns false for framework ids outside the catalog", () => {
    expect(frameworkCompatibleWithTarget({ architecture: "esp32" }, "esp-idf")).toBe(false);
  });
});

// ── framework-specific build target + toolchain (the bug: Arduino FQBN was
// written for Zephyr projects; Zephyr needs its own board id + 'west'). ───────

describe("frameworkTargetProfile", () => {
  it("uses the Arduino FQBN + arduino-cli for arduino", () => {
    expect(frameworkTargetProfile({ id: "esp32s3", buildTarget: "esp32:esp32:esp32s3" }, "arduino")).toEqual({
      buildTarget: "esp32:esp32:esp32s3",
      toolchainType: "arduino-cli",
    });
  });

  it("uses the Zephyr board id + west for zephyr (esp32s3)", () => {
    expect(frameworkTargetProfile({ id: "esp32s3", buildTarget: "esp32:esp32:esp32s3" }, "zephyr")).toEqual({
      buildTarget: "esp32s3_devkitc/esp32s3/procpu",
      toolchainType: "west",
    });
  });

  it("uses the Zephyr board id + west for zephyr (esp32-devkit)", () => {
    expect(frameworkTargetProfile({ id: "esp32-devkit", buildTarget: "esp32:esp32:esp32" }, "zephyr")).toEqual({
      buildTarget: "esp32_devkitc/esp32/procpu",
      toolchainType: "west",
    });
  });

  it("returns an empty profile for native (no buildTarget / toolchain)", () => {
    expect(frameworkTargetProfile({ id: "native", isNative: true }, "native")).toEqual({});
  });

  it("still gives AVR its FQBN under arduino", () => {
    expect(frameworkTargetProfile({ id: "arduino-uno", buildTarget: "arduino:avr:uno" }, "arduino")).toEqual({
      buildTarget: "arduino:avr:uno",
      toolchainType: "arduino-cli",
    });
  });

  it("locks in the correct qualified Zephyr target for every supported board", () => {
    // Zephyr 4.3+ rejects bare multi-core board names ("Board qualifiers … not
    // found"), so every ESP32-family descriptor must carry its /<soc>/<core>
    // qualifier. xiao_ble is single-core but qualified for consistency/safety.
    expect(frameworkTargetProfile({ id: "esp32-devkit" }, "zephyr").buildTarget).toBe(
      "esp32_devkitc/esp32/procpu",
    );
    expect(frameworkTargetProfile({ id: "esp32s3" }, "zephyr").buildTarget).toBe(
      "esp32s3_devkitc/esp32s3/procpu",
    );
    expect(frameworkTargetProfile({ id: "xiao-nrf52840" }, "zephyr").buildTarget).toBe(
      "xiao_ble/nrf52840",
    );
    expect(frameworkTargetProfile({ id: "esp32c3" }, "zephyr").buildTarget).toBe(
      "esp32c3_devkitm/esp32c3",
    );
    expect(frameworkTargetProfile({ id: "esp32c6" }, "zephyr").buildTarget).toBe(
      "esp32c6_devkitc/esp32c6/hpcore",
    );
    expect(frameworkTargetProfile({ id: "blackpill-f411ce" }, "zephyr").buildTarget).toBe(
      "blackpill_f411ce/stm32f411xe",
    );
  });

  it("never emits a bare Zephyr board id (every Zephyr target is qualified)", () => {
    for (const boardId of ["esp32-devkit", "esp32s3", "xiao-nrf52840", "esp32c3", "esp32c6", "blackpill-f411ce"]) {
      const bt = frameworkTargetProfile({ id: boardId }, "zephyr").buildTarget ?? "";
      expect(bt.includes("/")).toBe(true);
    }
  });
});

// ── package-manager detection ───────────────────────────────────────────────

function makeTempDir(seed?: Record<string, string>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cuttlefish-create-"));
  if (seed) {
    for (const [name, contents] of Object.entries(seed)) {
      fs.writeFileSync(path.join(dir, name), contents);
    }
  }
  return dir;
}

describe("detectPackageManager", () => {
  it("honors package.json#packageManager (pnpm/yarn/npm)", () => {
    expect(detectPackageManager(makeTempDir({ "package.json": JSON.stringify({ packageManager: "pnpm@9.12.0" }) }))).toBe("pnpm");
    expect(detectPackageManager(makeTempDir({ "package.json": JSON.stringify({ packageManager: "yarn@4.0.0" }) }))).toBe("yarn");
    expect(detectPackageManager(makeTempDir({ "package.json": JSON.stringify({ packageManager: "npm@10.8.0" }) }))).toBe("npm");
  });

  it("falls back to lockfile presence", () => {
    expect(detectPackageManager(makeTempDir({ "pnpm-lock.yaml": "" }))).toBe("pnpm");
    expect(detectPackageManager(makeTempDir({ "yarn.lock": "" }))).toBe("yarn");
    expect(detectPackageManager(makeTempDir({ "package-lock.json": "{}" }))).toBe("npm");
  });

  it("defaults to npm with no signals", () => {
    expect(detectPackageManager(makeTempDir())).toBe("npm");
  });

  it("does not throw on an unparseable package.json", () => {
    expect(detectPackageManager(makeTempDir({ "package.json": "{ not valid" }))).toBe("npm");
  });
});

// ── installProjectDependencies (spawn, via the test runner hook) ────────────

describe("installProjectDependencies", () => {
  it("runs '<pm> install' in the project dir, detecting pm from the invoking cwd", () => {
    const invoking = makeTempDir({ "package.json": JSON.stringify({ packageManager: "pnpm@9.0.0" }) });
    const project = makeTempDir();
    const seen: Array<{ bin: string; args: string[]; cwd: string }> = [];
    __setProjectInstallRunnerForTest((cmd) => {
      seen.push({ ...cmd });
      return { status: 0 };
    });

    const result = installProjectDependencies({ projectDir: project, cwd: invoking });

    expect(result.pm).toBe("pnpm");
    expect(seen).toEqual([{ bin: "pnpm", args: ["install"], cwd: project }]);
  });

  it("defaults to npm when the invoking cwd has no pm signal", () => {
    const project = makeTempDir();
    __setProjectInstallRunnerForTest(() => ({ status: 0 }));
    expect(installProjectDependencies({ projectDir: project, cwd: makeTempDir() }).pm).toBe("npm");
  });

  it("throws on non-zero exit status", () => {
    __setProjectInstallRunnerForTest(() => ({ status: 1 }));
    expect(() => installProjectDependencies({ projectDir: makeTempDir() })).toThrowError(/exited with code 1/);
  });

  it("throws on launch failure (binary missing)", () => {
    __setProjectInstallRunnerForTest(() => ({ status: null, launchError: "'npm' not found on PATH" }));
    expect(() => installProjectDependencies({ projectDir: makeTempDir() })).toThrowError(/not found on PATH/);
  });
});

describe('BOARD_PROBE_METHODS (create-time catalog vs board packages)', () => {
  it('mirrors the board packages flashMethods tables (ids must not drift)', async () => {
    const { resolveBoardConstants } = await import('../../../../packages/cuttlefish/src/ir/board-resolver');
    const { resolveChipFromBoard } = await import('../../../../packages/framework-zephyr/src/chips/resolve');
    const boardSrc: Record<string, string> = {
      'blackpill-f411ce': 'boards/board-blackpill-f411ce/src/index.ts',
      'xiao-nrf52840': 'boards/board-xiao-nrf52840/src/index.ts',
    };
    for (const [boardId, src] of Object.entries(boardSrc)) {
      const catalog = BOARD_PROBE_METHODS[boardId];
      expect(catalog, `catalog entry for ${boardId}`).toBeDefined();
      const chip = resolveChipFromBoard(resolveBoardConstants(src));
      const ids = (chip?.probeMethods ?? []).map((m) => m.id);
      expect(catalog.map((m) => m.id), `ids for ${boardId}`).toEqual(ids);
    }
  });
});
