// Framework catalog + board→framework compatibility for the create wizard.
//
// A "framework" is a `@typecad/framework-<id>` npm package. This module is the
// single source of truth for which frameworks exist as installable packages and
// which are compatible with a given board architecture. It is deliberately
// free of side effects (no fs/process beyond lockfile/package.json reads in
// detectPackageManager) so it unit-tests cleanly.

import path from "node:path";
import fs from "node:fs";
import { findPackBoard } from "./pack-targets.js";

/** A framework family that ships as an installable @typecad/framework-* package. */
export interface FrameworkCatalogEntry {
  /** Short id, e.g. "arduino". Matches the suffix of @typecad/framework-<id>. */
  id: string;
  /** Full npm package name, e.g. "@typecad/framework-arduino". */
  packageName: string;
  /** Human-readable label shown in the create prompt. */
  label: string;
  /**
   * Whether a real package exists on the registry. Used to filter the prompt:
   * "esp-idf" is a known family with no published package yet, so it must not
   * be offered (it would fail at the package-manager step).
   */
  installable: boolean;
  /**
   * True when the framework ships inside @typecad/cuttlefish (no separate npm
   * package): the scaffold must not add it to project dependencies, and the
   * loader (framework-package.ts) resolves it internally instead of via
   * require.resolve. The config string stays the package name for continuity.
   */
  builtin?: boolean;
}

/**
 * The usable frameworks. zephyr ships as a real package; native is built
 * into @typecad/cuttlefish (formerly a separate package, now resolved
 * internally). esp-idf is intentionally absent (no published package).
 */
export const FRAMEWORK_CATALOG: readonly FrameworkCatalogEntry[] = [
  { id: "zephyr", packageName: "@typecad/framework-zephyr", label: "Zephyr RTOS", installable: true },
  { id: "native", packageName: "@typecad/framework-native", label: "Native (Windows/Linux executable)", installable: true, builtin: true },
];

/** True iff the framework package ships inside @typecad/cuttlefish and needs
 *  no separate npm dependency in scaffolded projects. */
export function isBuiltinFramework(packageName: string): boolean {
  return FRAMEWORK_CATALOG.some((f) => f.packageName === packageName && f.builtin === true);
}

/** Structural shape we need from a board/target. Keeps this module decoupled
 *  from the KnownTarget type (and trivially testable with literals). */
export interface BoardLike {
  isNative?: boolean;
  architecture?: string;
}

/**
 * Architecture → compatible framework ids. Derived from each framework
 * package's framework.manifest.ts `profile.targets`:
 *   - zephyr:  nrf52 (xiao_ble), esp32 family (esp32, esp32s3, esp32c3, esp32c6),
 *              rp2040/rp2350 (rpi_pico, rpi_pico2), stm32f411 (blackpill),
 *              samd21 (nano_33_iot)
 *   - native:  desktop only
 * Unknown embedded architectures fall back to [zephyr].
 */
const ARCHITECTURE_FRAMEWORKS: Record<string, string[]> = {
  esp32: ["zephyr"],
  esp32s3: ["zephyr"],
  esp32c3: ["zephyr"],
  esp32c6: ["zephyr"],
  rp2040: ["zephyr"],
  rp2350: ["zephyr"],
  // Per-chip key (stm32f411 style) — the Black Pill's generic 'stm32' family
  // has no other supported silicon today.
  samd21: ["zephyr"],
  stm32f411: ["zephyr"],
  nrf52: ["zephyr"],
};

const FALLBACK_FRAMEWORKS: readonly string[] = ["zephyr"];

/** Look up a catalog entry by framework id (e.g. "arduino"). */
export function frameworkCatalogEntry(id: string): FrameworkCatalogEntry | undefined {
  return FRAMEWORK_CATALOG.find((f) => f.id === id);
}

// ── framework-specific build target + toolchain ─────────────────────────────
// A board's buildTarget string is framework-specific: Zephyr uses a board id
// for `west build -b` (e.g. 'esp32s3_devkitc/esp32s3/procpu'). The scaffold
// must pick the right one for the chosen framework, and the matching
// toolchain backend ('west'). Source for Zephyr board ids: framework-zephyr's
// chip registry (src/chips/index.ts) + the demo configs.

const FRAMEWORK_TOOLCHAIN: Record<string, string> = {
  zephyr: "west",
  // native has no toolchain (the native config path writes neither field).
};

/**
 * Zephyr build targets come straight from the board catalog (the pack or a
 * local `cuttlefish board sync` overlay) — every catalog board carries its
 * own qualified `west build -b` target. There is no curated id→target map.
 */

/**
 * Probe method a board offers, for `cuttlefish create`'s wizard (which runs
 * BEFORE the framework is installed, so it reads the board data pack — the
 * same table boardgen emits into the generated board module for tier-3
 * boards, extracted from each board's own board.cmake runners).
 */
export interface CatalogProbeMethod {
  id: string;
  description: string;
}

/**
 * The probe methods a board offers, from the board data pack. Accepts a
 * qualified Zephyr target ('blackpill_f401ce/stm32f401xe'), a bare board id,
 * or undefined. Empty when the board ships no runner table — then no probe
 * question is asked and no zephyr.probe section is scaffolded.
 */
export function probeMethodsForBoard(boardId: string | undefined): CatalogProbeMethod[] {
  if (!boardId) return [];
  const entry = findPackBoard(boardId);
  if (!entry?.probeMethods) return [];
  return entry.probeMethods.map((m) => ({ id: m.id, description: m.description }));
}

export interface FrameworkTargetProfile {
  /** Framework-specific build target (FQBN for Arduino, board id for Zephyr). */
  buildTarget?: string;
  /** Toolchain backend the framework's compile/upload expects. */
  toolchainType?: string;
}

export interface TargetProfileInput {
  id: string;
  isNative?: boolean;
  /** The board's default build target, as currently stored on KnownTarget. */
  buildTarget?: string;
}

/**
 * Resolve the framework-specific buildTarget + toolchain type for a
 * (board, framework) pair. Zephyr maps the board id to its Zephyr board
 * target; native returns an empty profile (the native config writes neither
 * field); any unlisted framework falls back to the board's stored target.
 */
export function frameworkTargetProfile(
  target: TargetProfileInput,
  frameworkId: string,
): FrameworkTargetProfile {
  if (target.isNative) {
    return {};
  }
  const toolchainType = FRAMEWORK_TOOLCHAIN[frameworkId];
  if (frameworkId === "zephyr") {
    // The target input's buildTarget IS the qualified catalog identifier.
    return { buildTarget: target.buildTarget, toolchainType };
  }
  // Unlisted framework → pass the board's stored build target through.
  return { buildTarget: target.buildTarget, toolchainType };
}

/**
 * The framework ids compatible with a board. Native boards map to ["native"];
 * embedded boards map via ARCHITECTURE_FRAMEWORKS (falling back to zephyr for
 * unknown architectures). Order is preserved as the catalog order so the most
 * common framework is offered first in the prompt.
 */
export function frameworksForTarget(target: BoardLike): FrameworkCatalogEntry[] {
  let ids: readonly string[];
  if (target.isNative) {
    ids = ["native"];
  } else {
    ids = ARCHITECTURE_FRAMEWORKS[target.architecture ?? ""] ?? FALLBACK_FRAMEWORKS;
  }
  // Re-map ids → catalog entries in catalog order (stable ordering), dropping
  // any id that has no catalog entry (defensive — keeps the prompt clean).
  return FRAMEWORK_CATALOG.filter((entry) => ids.includes(entry.id));
}

/**
 * Whether `frameworkId` is actually offered for `target`: compatible with the
 * board's architecture AND installable. Auto-picking narrows via
 * frameworksForTarget, but an explicit `--framework` bypasses that narrowing —
 * callers accepting one must reject anything this returns false for (e.g.
 * `--framework native` on an embedded board).
 */
export function frameworkCompatibleWithTarget(target: BoardLike, frameworkId: string): boolean {
  return frameworksForTarget(target).some((f) => f.id === frameworkId && f.installable);
}

// ── package-manager detection ──────────────────────────────────────────────

export type PackageManager = "npm" | "pnpm" | "yarn";

/**
 * Detect the package manager for a directory. Priority:
 *   1. package.json#packageManager field (the strongest signal, Corepack-style)
 *   2. lockfile presence (pnpm-lock.yaml / yarn.lock → otherwise npm)
 *   3. default "npm"
 * Never throws — unreadable/missing files fall through to the next signal.
 */
export function detectPackageManager(cwd: string): PackageManager {
  try {
    const pkgPath = path.join(cwd, "package.json");
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8")) as { packageManager?: unknown };
    const pm = typeof pkg.packageManager === "string" ? pkg.packageManager : "";
    if (pm.startsWith("pnpm")) return "pnpm";
    if (pm.startsWith("yarn")) return "yarn";
    if (pm.startsWith("npm")) return "npm";
  } catch {
    // no package.json or unparseable JSON — fall through to lockfile detection
  }

  if (fs.existsSync(path.join(cwd, "pnpm-lock.yaml"))) return "pnpm";
  if (fs.existsSync(path.join(cwd, "yarn.lock"))) return "yarn";
  // package-lock.json implies npm; absence also defaults to npm.
  return "npm";
}
