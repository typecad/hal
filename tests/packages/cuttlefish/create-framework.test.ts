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
  probeMethodsForBoard,
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
  it("narrows esp32 to zephyr", () => {
    expect(frameworksForTarget({ architecture: "esp32" }).map((f) => f.id)).toEqual(["zephyr"]);
  });

  it("narrows esp32s3 to zephyr", () => {
    expect(frameworksForTarget({ architecture: "esp32s3" }).map((f) => f.id)).toEqual(["zephyr"]);
  });

  it("narrows esp32c3 / esp32c6 to zephyr", () => {
    for (const arch of ["esp32c3", "esp32c6"]) {
      expect(frameworksForTarget({ architecture: arch }).map((f) => f.id)).toEqual(["zephyr"]);
    }
  });

  it("narrows rp2040 / rp2350 to zephyr (rpi_pico / rpi_pico2 targets)", () => {
    for (const arch of ["rp2040", "rp2350"]) {
      expect(frameworksForTarget({ architecture: arch }).map((f) => f.id)).toEqual(["zephyr"]);
    }
  });

  it("maps native boards to [native]", () => {
    expect(frameworksForTarget({ isNative: true }).map((f) => f.id)).toEqual(["native"]);
  });

  it("maps nrf52 to [zephyr]", () => {
    expect(frameworksForTarget({ architecture: "nrf52" }).map((f) => f.id)).toEqual(["zephyr"]);
  });

  it("maps per-chip keys (stm32f411, samd21) to [zephyr]", () => {
    expect(frameworksForTarget({ architecture: "stm32f411" }).map((f) => f.id)).toEqual(["zephyr"]);
    expect(frameworksForTarget({ architecture: "samd21" }).map((f) => f.id)).toEqual(["zephyr"]);
  });

  it("falls back to [zephyr] for an unknown architecture (avr silicon was removed)", () => {
    for (const arch of ["totally-unknown-mcu", "avr", "stm32", "samd"]) {
      expect(frameworksForTarget({ architecture: arch }).map((f) => f.id)).toEqual(["zephyr"]);
    }
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
  it("accepts zephyr for nrf52 and rejects arduino (removed framework)", () => {
    expect(frameworkCompatibleWithTarget({ architecture: "nrf52" }, "zephyr")).toBe(true);
    expect(frameworkCompatibleWithTarget({ architecture: "nrf52" }, "arduino")).toBe(false);
  });

  it("accepts only zephyr for embedded architectures", () => {
    for (const arch of ["esp32", "esp32s3"]) {
      expect(frameworkCompatibleWithTarget({ architecture: arch }, "arduino")).toBe(false);
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

// ── framework-specific build target + toolchain (Zephyr needs its own board
// id + 'west'). ───────────────────────────────────────────────────────────────

describe("frameworkTargetProfile", () => {
  it("uses the Zephyr board id + west for zephyr (esp32s3)", () => {
    expect(frameworkTargetProfile({ id: "esp32s3", buildTarget: "esp32s3_devkitc/esp32s3/procpu" }, "zephyr")).toEqual({
      buildTarget: "esp32s3_devkitc/esp32s3/procpu",
      toolchainType: "west",
    });
  });

  it("uses the Zephyr board id + west for zephyr (esp32-devkit)", () => {
    expect(frameworkTargetProfile({ id: "esp32-devkit", buildTarget: "esp32_devkitc/esp32/procpu" }, "zephyr")).toEqual({
      buildTarget: "esp32_devkitc/esp32/procpu",
      toolchainType: "west",
    });
  });

  it("returns an empty profile for native (no buildTarget / toolchain)", () => {
    expect(frameworkTargetProfile({ id: "native", isNative: true }, "native")).toEqual({});
  });

  it("passes the catalog's qualified target through for Zephyr", () => {
    // The curated id→target map is gone — the target input carries its own
    // qualified catalog identifier and Zephyr passes it straight through.
    expect(frameworkTargetProfile({ id: "p", buildTarget: "esp32_devkitc/esp32/procpu" }, "zephyr").buildTarget).toBe(
      "esp32_devkitc/esp32/procpu",
    );
    expect(frameworkTargetProfile({ id: "p", buildTarget: "xiao_ble/nrf52840" }, "zephyr").toolchainType).toBe(
      frameworkTargetProfile({ id: "p", buildTarget: "xiao_ble/nrf52840" }, "zephyr").toolchainType,
    );
  });

  it("the pass-through keeps every catalog target qualified", () => {
    for (const bt of ["esp32_devkitc/esp32/procpu", "xiao_ble/nrf52840", "blackpill_f411ce/stm32f411xe"]) {
      expect(frameworkTargetProfile({ id: "p", buildTarget: bt }, "zephyr").buildTarget?.includes("/")).toBe(true);
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

describe('probeMethodsForBoard (create-time catalog from the board data pack)', () => {
  it('resolves qualified Zephyr targets and bare board ids', () => {
    // The wizard passes the qualified target; --board may carry a bare id.
    const qualified = probeMethodsForBoard('blackpill_f401ce/stm32f401xe');
    expect(qualified.map((m) => m.id)).toContain('stlink');
    expect(qualified.map((m) => m.id)).toContain('dfu');
    const bare = probeMethodsForBoard('blackpill_f401ce');
    expect(bare.map((m) => m.id)).toContain('stlink');
  });

  it('is case-sensitive for @revision qualifiers', () => {
    expect(probeMethodsForBoard('mimxrt1060_evk@A/mimxrt1062/qspi').length).toBeGreaterThan(0);
  });

  it('every wizard id resolves (the pack table is the one table now)', async () => {
    const { generateBoard } = await import('../../../../packages/framework-zephyr/src/boardgen');
    const f411 = JSON.parse(generateBoard('blackpill_f411ce/stm32f411xe').boardJson);
    const ids = (i: string) => f411.constants[`zephyr.probeMethods.${i}.id`] as string | undefined;
    const all: string[] = [];
    for (let i = 0; ids(String(i)) !== undefined; i++) all.push(ids(String(i)));
    expect(all).toEqual(['dfu', 'stlink', 'jlink', 'blackmagicprobe']);
  }, 180_000);
});

// ---------------------------------------------------------------------------
// Wizard spec plumbing — the probe/port/baud choices must land in the
// scaffolded config (console.port, test.port, zephyr.probe).
// ---------------------------------------------------------------------------

describe('generateProjectConfig — wizard choices ride the config', () => {
  it('emits zephyr.probe and the chosen serial port in both port fields', async () => {
    const { generateProjectConfig } = await import('../../../packages/cuttlefish/src/create/templates');
    const cfg = generateProjectConfig({
      projectName: 'p',
      targetId: 'blackpill_f401ce',
      targetDisplayName: 'Black Pill',
      isNative: false,
      frameworkPackage: '@typecad/framework-zephyr',
      framework: 'zephyr',
      board: 'blackpill_f401ce/stm32f401xe',
      buildTarget: 'blackpill_f401ce/stm32f401xe',
      probeMethod: 'stlink',
      probeMethods: [{ id: 'dfu' }, { id: 'stlink' }, { id: 'jlink' }],
      port: 'COM10',
      baudRate: 115200,
      includeStarter: true,
    });
    expect(cfg).toContain("probe: 'stlink'");
    expect(cfg).toContain("port: 'COM10'");
    // Both console.port and test.port carry the choice — no COM4 guesses.
    expect(cfg.match(/port: 'COM10'/g)).toHaveLength(2);
    expect(cfg).not.toContain("COM4'");
  });

  it('falls back to the platform hint when no port was chosen', async () => {
    const { generateProjectConfig } = await import('../../../packages/cuttlefish/src/create/templates');
    const cfg = generateProjectConfig({
      projectName: 'p',
      targetId: 'xiao_ble',
      targetDisplayName: 'XIAO BLE',
      isNative: false,
      frameworkPackage: '@typecad/framework-zephyr',
      framework: 'zephyr',
      board: 'xiao_ble/nrf52840',
      buildTarget: 'xiao_ble/nrf52840',
      baudRate: 115200,
      includeStarter: true,
    });
    const hint = process.platform === 'win32' ? 'COM4' : '/dev/ttyACM0';
    expect(cfg).toContain(`port: '${hint}'`);
    expect(cfg).not.toContain("probe: '");
  });
});

describe('detectSerialPorts — dependency-free enumeration', () => {
  it('returns a list (possibly empty) without throwing', async () => {
    const { detectSerialPorts } = await import('../../../packages/cuttlefish/src/create/wizard');
    const ports = detectSerialPorts();
    expect(Array.isArray(ports)).toBe(true);
    for (const p of ports) expect(p).toMatch(/^(COM\d+|\/dev\/)/);
  });
});
