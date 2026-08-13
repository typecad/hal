import { describe, it, expect, afterEach, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

// Mock discoverWest so tests that rely on "undetectable Zephyr" are isolated
// from the host's real installs (micromamba env, etc.).
vi.mock("../../../packages/framework-zephyr/src/toolchain/west-discover.js", () => ({
  discoverWest: () => null,
}));

import {
  checkZephyrEnv,
  boardExistsInCheckout,
  type WestProbeData,
} from "../../../packages/framework-zephyr/src/toolchain/env-check";

// detectZephyrVersion()/checkZephyrCompat() read process.env.ZEPHYR_BASE + the
// VERSION file, so tests that care about the zephyr version stage it on disk.
const ORIG_ZEPHYR_BASE = process.env.ZEPHYR_BASE;

afterEach(() => {
  if (ORIG_ZEPHYR_BASE === undefined) delete process.env.ZEPHYR_BASE;
  else process.env.ZEPHYR_BASE = ORIG_ZEPHYR_BASE;
});

/** Write a CMake-style VERSION file into a temp dir and point ZEPHYR_BASE at it. */
function withVersionFile(major: number, minor: number, patch: number): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "zephyr-env-"));
  fs.writeFileSync(
    path.join(dir, "VERSION"),
    `VERSION_MAJOR = ${major}\nVERSION_MINOR = ${minor}\nPATCHLEVEL = ${patch}\n`,
  );
  process.env.ZEPHYR_BASE = dir;
  return dir;
}

const WEST_OK: WestProbeData = {
  westFound: true,
  westVersion: "1.3.0",
  source: "path",
  zephyrBase: "/fake/zephyr",
};

// ── checkZephyrEnv branches (injected probe + board lookup — no real spawns) ─

describe("checkZephyrEnv", () => {
  it("is OK when west is found, Zephyr is in range, and the board exists", () => {
    withVersionFile(4, 3, 99);
    const result = checkZephyrEnv("xiao_ble", {
      fakeWestProbe: WEST_OK,
      fakeBoardExists: () => true,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.check.westFound).toBe(true);
    expect(result.check.westVersion).toBe("1.3.0");
    expect(result.check.zephyrVersion).toBe("4.3.99");
    expect(result.check.compatStatus).toBe("ok");
    expect(result.check.boardTargetSupported).toBe(true);
  });

  it("normalizes the resolved board target before the existence check", () => {
    withVersionFile(4, 3, 99);
    let seenBoardId = "";
    const result = checkZephyrEnv("esp32s3_devkitc", {
      fakeWestProbe: WEST_OK,
      fakeBoardExists: (id) => {
        seenBoardId = id;
        return true;
      },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // The bare multi-core id is qualified, but the board-existence lookup keys
    // off the board id (first segment), which is unchanged.
    expect(result.check.resolvedBoardTarget).toBe("esp32s3_devkitc/esp32s3/procpu");
    expect(seenBoardId).toBe("esp32s3_devkitc");
  });

  it("fails with 'west-not-found' when no west install is discovered", () => {
    withVersionFile(4, 3, 99);
    const result = checkZephyrEnv("xiao_ble", {
      fakeWestProbe: { ...WEST_OK, westFound: false, westVersion: undefined, source: undefined },
      fakeBoardExists: () => true,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("west-not-found");
    expect(result.messages[0]).toContain("west");
    expect(result.check.westFound).toBe(false);
  });

  it("fails with 'zephyr-out-of-range' when the Zephyr version is too old", () => {
    withVersionFile(3, 7, 0);
    const result = checkZephyrEnv("xiao_ble", {
      fakeWestProbe: WEST_OK,
      fakeBoardExists: () => true,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("zephyr-out-of-range");
    expect(result.check.compatStatus).toBe("out-of-range");
    expect(result.messages[0]).toContain("3.7.0");
  });

  it("fails with 'board-not-supported' when the board is missing from the checkout", () => {
    withVersionFile(4, 3, 99);
    const result = checkZephyrEnv("xiao_ble", {
      fakeWestProbe: WEST_OK,
      fakeBoardExists: () => false,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("board-not-supported");
    expect(result.check.boardTargetSupported).toBe(false);
    expect(result.fixCommand).toBe("west boards");
  });

  it("is OK (soft) with an undetectable Zephyr version — compat check skipped", () => {
    delete process.env.ZEPHYR_BASE;
    const result = checkZephyrEnv("xiao_ble", {
      fakeWestProbe: WEST_OK,
      fakeBoardExists: () => true,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.check.compatStatus).toBe("undetectable");
    expect(result.check.zephyrVersion).toBeUndefined();
  });

  it("skips the board check when no buildTarget is configured", () => {
    withVersionFile(4, 3, 99);
    const result = checkZephyrEnv(undefined, {
      fakeWestProbe: WEST_OK,
      fakeBoardExists: () => false,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.check.buildTarget).toBeUndefined();
    expect(result.check.resolvedBoardTarget).toBeUndefined();
    expect(result.check.boardTargetSupported).toBeUndefined();
  });

  it("is OK when the board lookup is inconclusive (no ZEPHYR_BASE)", () => {
    withVersionFile(4, 3, 99);
    const result = checkZephyrEnv("xiao_ble", {
      fakeWestProbe: { ...WEST_OK, zephyrBase: undefined },
      fakeBoardExists: () => undefined,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.check.boardTargetSupported).toBeUndefined();
  });
});

// ── failure precedence (most fundamental check wins) ─────────────────────────

describe("checkZephyrEnv precedence", () => {
  it("west-not-found beats board-not-supported", () => {
    withVersionFile(4, 3, 99);
    const result = checkZephyrEnv("xiao_ble", {
      fakeWestProbe: { ...WEST_OK, westFound: false, westVersion: undefined, source: undefined },
      fakeBoardExists: () => false,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("west-not-found");
  });

  it("zephyr-out-of-range beats board-not-supported", () => {
    withVersionFile(3, 7, 0);
    const result = checkZephyrEnv("xiao_ble", {
      fakeWestProbe: WEST_OK,
      fakeBoardExists: () => false,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("zephyr-out-of-range");
  });
});

// ── boardExistsInCheckout (real fs, HWMv2 vendor layout) ─────────────────────

describe("boardExistsInCheckout", () => {
  it("finds a board under boards/<vendor>/<boardId>/", () => {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), "zephyr-boards-"));
    try {
      fs.mkdirSync(path.join(base, "boards", "nordic", "xiao_ble"), { recursive: true });
      expect(boardExistsInCheckout("xiao_ble", base)).toBe(true);
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
    }
  });

  it("returns false when the board is absent", () => {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), "zephyr-boards-"));
    try {
      fs.mkdirSync(path.join(base, "boards", "nordic"), { recursive: true });
      expect(boardExistsInCheckout("xiao_ble", base)).toBe(false);
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
    }
  });

  it("returns undefined when ZEPHYR_BASE is not set", () => {
    expect(boardExistsInCheckout("xiao_ble", undefined)).toBeUndefined();
  });

  it("returns undefined when the boards/ tree can't be read", () => {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), "zephyr-empty-"));
    try {
      // No boards/ directory at all.
      expect(boardExistsInCheckout("xiao_ble", base)).toBeUndefined();
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
    }
  });
});
