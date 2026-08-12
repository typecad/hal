// Framework catalog + board→framework compatibility for `cuttlefish install`.
//
// A "framework" is a `@typecad/framework-<id>` npm package. This module is the
// single source of truth for which frameworks exist as installable packages and
// which are compatible with a given board architecture. It is deliberately
// free of side effects (no fs/process beyond lockfile/package.json reads in
// detectPackageManager) so it unit-tests cleanly.

import path from "node:path";
import fs from "node:fs";

/** A framework family that ships as an installable @typecad/framework-* package. */
export interface FrameworkCatalogEntry {
  /** Short id, e.g. "arduino". Matches the suffix of @typecad/framework-<id>. */
  id: string;
  /** Full npm package name, e.g. "@typecad/framework-arduino". */
  packageName: string;
  /** Human-readable label shown in the install prompt. */
  label: string;
  /**
   * Whether a real package exists on the registry. Used to filter the prompt:
   * "esp-idf" is a known family with no published package yet, so it must not
   * be offered for install (it would fail at the package-manager step).
   */
  installable: boolean;
}

/**
 * The installable frameworks. Kept aligned with the packages/ directory:
 * framework-arduino, framework-native, framework-zephyr all ship real packages.
 * esp-idf is intentionally absent (no published package in this repo).
 */
export const FRAMEWORK_CATALOG: readonly FrameworkCatalogEntry[] = [
  { id: "arduino", packageName: "@typecad/framework-arduino", label: "Arduino (digitalWrite, Wire, SPI)", installable: true },
  { id: "zephyr", packageName: "@typecad/framework-zephyr", label: "Zephyr RTOS", installable: true },
  { id: "native", packageName: "@typecad/framework-native", label: "Native (Windows/Linux executable)", installable: true },
];

/** Structural shape we need from a board/target. Keeps this module decoupled
 *  from the create/ module's KnownTarget (and trivially testable with literals). */
export interface BoardLike {
  isNative?: boolean;
  architecture?: string;
}

/**
 * Architecture → compatible framework ids. Derived from each framework
 * package's framework.manifest.ts `profile.targets`:
 *   - arduino: avr, esp32 family, rp2040/rp2350, samd, stm32
 *   - zephyr:  nrf52 (xiao_ble), esp32, esp32s3
 *   - native:  desktop only
 * Unknown embedded architectures fall back to [arduino] (the broadest core).
 */
const ARCHITECTURE_FRAMEWORKS: Record<string, string[]> = {
  avr: ["arduino"],
  esp32: ["arduino", "zephyr"],
  esp32s2: ["arduino"],
  esp32s3: ["arduino", "zephyr"],
  esp32c3: ["arduino"],
  esp32c6: ["arduino"],
  rp2040: ["arduino"],
  rp2350: ["arduino"],
  samd: ["arduino"],
  stm32: ["arduino"],
  nrf52: ["zephyr"],
};

const FALLBACK_FRAMEWORKS: readonly string[] = ["arduino"];

/** Look up a catalog entry by framework id (e.g. "arduino"). */
export function frameworkCatalogEntry(id: string): FrameworkCatalogEntry | undefined {
  return FRAMEWORK_CATALOG.find((f) => f.id === id);
}

/**
 * The framework ids compatible with a board. Native boards map to ["native"];
 * embedded boards map via ARCHITECTURE_FRAMEWORKS (falling back to arduino for
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

/**
 * Build the package-manager invocation that installs `packageName` into the
 * current project (project-local, never global — per the install command spec).
 */
export function buildInstallCommand(
  pm: PackageManager,
  packageName: string,
): { bin: string; args: string[] } {
  switch (pm) {
    case "pnpm":
      return { bin: "pnpm", args: ["add", packageName] };
    case "yarn":
      return { bin: "yarn", args: ["add", packageName] };
    case "npm":
    default:
      return { bin: "npm", args: ["install", packageName] };
  }
}
