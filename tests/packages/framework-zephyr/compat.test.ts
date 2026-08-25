import { describe, it, expect, afterEach, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

// Mock discoverWest so detectZephyrVersion tests are isolated from the host's
// real installs (micromamba env, system python, etc.). Without this, the
// fallback in detectZephyrVersion finds a real env and the "returns undefined"
// assertion becomes machine-dependent.
vi.mock("../../../packages/framework-zephyr/src/toolchain/west-discover.js", () => ({
  discoverWest: () => null,
}));

import {
  parseVersion,
  compareVersion,
  satisfiesRange,
  detectZephyrVersion,
  checkZephyrCompat,
  resolveBoardTarget,
} from "../../../packages/framework-zephyr/src/toolchain/compat";

const ORIG_ZEPHYR_BASE = process.env.ZEPHYR_BASE;

afterEach(() => {
  // detectZephyrVersion reads process.env.ZEPHYR_BASE — restore it between tests.
  if (ORIG_ZEPHYR_BASE === undefined) delete process.env.ZEPHYR_BASE;
  else process.env.ZEPHYR_BASE = ORIG_ZEPHYR_BASE;
});

function withVersionFile(contents: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "zephyr-version-"));
  fs.writeFileSync(path.join(dir, "VERSION"), contents);
  process.env.ZEPHYR_BASE = dir;
  return dir;
}

// ── semver helpers ──────────────────────────────────────────────────────────

describe("parseVersion", () => {
  it("parses X.Y.Z", () => {
    expect(parseVersion("4.3.99")).toEqual([4, 3, 99]);
  });
  it("parses a leading v and missing patch", () => {
    expect(parseVersion("v4.3")).toEqual([4, 3, 0]);
  });
  it("strips a pre-release suffix", () => {
    expect(parseVersion("4.3.99-rc1")).toEqual([4, 3, 99]);
  });
  it("returns undefined for garbage", () => {
    expect(parseVersion("zephyr")).toBeUndefined();
  });
});

describe("compareVersion", () => {
  it("orders across major/minor/patch", () => {
    expect(compareVersion("4.3.0", "4.3.1")).toBe(-1);
    expect(compareVersion("4.4.0", "4.3.99")).toBe(1);
    expect(compareVersion("4.3.99", "4.3.99")).toBe(0);
  });
});

describe("satisfiesRange", () => {
  it("accepts an in-range version", () => {
    expect(satisfiesRange("4.3.99", ">=4.3 <5.0")).toBe(true);
    expect(satisfiesRange("4.4.2", ">=4.3 <5.0")).toBe(true);
  });
  it("rejects below the floor", () => {
    expect(satisfiesRange("4.2.99", ">=4.3 <5.0")).toBe(false);
  });
  it("rejects at/above the ceiling", () => {
    expect(satisfiesRange("5.0.0", ">=4.3 <5.0")).toBe(false);
  });
  it("treats the floor as inclusive", () => {
    expect(satisfiesRange("4.3.0", ">=4.3")).toBe(true);
    expect(satisfiesRange("4.2.99", ">=4.3")).toBe(false);
  });
});

// ── Zephyr version detection ────────────────────────────────────────────────

describe("detectZephyrVersion", () => {
  it("parses the CMake-style VERSION file", () => {
    withVersionFile("VERSION_MAJOR = 4\nVERSION_MINOR = 3\nPATCHLEVEL = 99\n");
    expect(detectZephyrVersion()).toBe("4.3.99");
  });
  it("parses a bare X.Y.Z", () => {
    withVersionFile("4.4.2\n");
    expect(detectZephyrVersion()).toBe("4.4.2");
  });
  it("defaults missing minor/patch to 0", () => {
    withVersionFile("VERSION_MAJOR = 4\n");
    expect(detectZephyrVersion()).toBe("4.0.0");
  });
  it("returns undefined when ZEPHYR_BASE is unset", () => {
    delete process.env.ZEPHYR_BASE;
    expect(detectZephyrVersion()).toBeUndefined();
  });
  it("returns undefined when the VERSION file is missing", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "zephyr-empty-"));
    process.env.ZEPHYR_BASE = dir;
    expect(detectZephyrVersion()).toBeUndefined();
  });
});

// ── compat check (reads the live manifest range '>=4.3 <5.0') ───────────────

describe("checkZephyrCompat", () => {
  it("accepts the current dev + installer versions", () => {
    expect(checkZephyrCompat("4.3.99").status).toBe("ok");
    expect(checkZephyrCompat("4.4.2").status).toBe("ok");
  });
  it("flags an older Zephyr as out-of-range", () => {
    expect(checkZephyrCompat("3.7.0").status).toBe("out-of-range");
  });
  it("flags a future major as out-of-range", () => {
    expect(checkZephyrCompat("5.0.0").status).toBe("out-of-range");
  });
  it("reports undetectable when the version is unknown", () => {
    expect(checkZephyrCompat(undefined).status).toBe("undetectable");
  });
  it("exposes the declared range", () => {
    expect(checkZephyrCompat("4.3.99").range).toBe(">=4.3 <5.0");
  });
});

// ── board-target normalization (the bug-class fix) ──────────────────────────

describe("resolveBoardTarget", () => {
  it("qualifies a bare multi-core board id on Zephyr >=4.3", () => {
    expect(resolveBoardTarget("esp32s3_devkitc", "4.3.99")).toBe("esp32s3_devkitc/esp32s3/procpu");
    expect(resolveBoardTarget("esp32_devkitc", "4.4.2")).toBe("esp32_devkitc/esp32/procpu");
  });
  it("is idempotent when the target is already qualified", () => {
    expect(resolveBoardTarget("esp32s3_devkitc/esp32s3/procpu", "4.3.99")).toBe(
      "esp32s3_devkitc/esp32s3/procpu",
    );
  });
  it("leaves a bare id unchanged on older Zephyr (<4.3 accepted it)", () => {
    expect(resolveBoardTarget("esp32s3_devkitc", "3.7.0")).toBe("esp32s3_devkitc");
  });
  it("leaves a bare id unchanged when the version is undetectable (conservative)", () => {
    expect(resolveBoardTarget("esp32s3_devkitc", undefined)).toBe("esp32s3_devkitc");
  });
  it("qualifies single-SoC boards too (bare-name normalization is going away)", () => {
    expect(resolveBoardTarget("xiao_ble", "4.4.2")).toBe("xiao_ble/nrf52840");
    expect(resolveBoardTarget("rpi_pico", "4.4.2")).toBe("rpi_pico/rp2040");
    // Idempotent — an already-qualified target is never rewritten.
    expect(resolveBoardTarget("xiao_ble/nrf52840", "4.4.2")).toBe("xiao_ble/nrf52840");
    expect(resolveBoardTarget("rpi_pico/rp2040", "4.4.2")).toBe("rpi_pico/rp2040");
  });
  it("leaves bare ids unchanged on older Zephyr (<4.3 did not accept the qualified form)", () => {
    expect(resolveBoardTarget("xiao_ble", "3.7.0")).toBe("xiao_ble");
    expect(resolveBoardTarget("rpi_pico", "3.7.0")).toBe("rpi_pico");
  });
  it("passes unknown boards through unchanged", () => {
    expect(resolveBoardTarget("some_future_board", "4.3.99")).toBe("some_future_board");
  });
});
