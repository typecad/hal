// Framework catalog + board→framework compatibility for the create wizard.
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
  /** Human-readable label shown in the create prompt. */
  label: string;
  /**
   * Whether a real package exists on the registry. Used to filter the prompt:
   * "esp-idf" is a known family with no published package yet, so it must not
   * be offered (it would fail at the package-manager step).
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
 *  from the KnownTarget type (and trivially testable with literals). */
export interface BoardLike {
  isNative?: boolean;
  architecture?: string;
}

/**
 * Architecture → compatible framework ids. Derived from each framework
 * package's framework.manifest.ts `profile.targets`:
 *   - arduino: avr, esp32 family, rp2040/rp2350, samd, stm32
 *   - zephyr:  nrf52 (xiao_ble), esp32 family (esp32, esp32s3, esp32c3, esp32c6),
 *              rp2040/rp2350 (rpi_pico, rpi_pico2), stm32f411 (blackpill)
 *   - native:  desktop only
 * Unknown embedded architectures fall back to [arduino] (the broadest core).
 */
const ARCHITECTURE_FRAMEWORKS: Record<string, string[]> = {
  avr: ["arduino"],
  esp32: ["arduino", "zephyr"],
  esp32s2: ["arduino"],
  esp32s3: ["arduino", "zephyr"],
  esp32c3: ["arduino", "zephyr"],
  esp32c6: ["arduino", "zephyr"],
  rp2040: ["arduino", "zephyr"],
  rp2350: ["arduino", "zephyr"],
  samd: ["arduino"],
  // Per-chip key (stm32f411 style) — the Nano 33 IoT is Zephyr-only today;
  // the generic 'samd' entry stays ["arduino"] for the Arduino SAMD core.
  samd21: ["zephyr"],
  // Per-chip key (esp32c3/c6 style). The generic 'stm32' entry stays
  // ["arduino"] for future STM32duino support; the F411 Black Pill is
  // Zephyr-only today.
  stm32f411: ["zephyr"],
  stm32: ["arduino"],
  nrf52: ["zephyr"],
};

const FALLBACK_FRAMEWORKS: readonly string[] = ["arduino"];

/** Look up a catalog entry by framework id (e.g. "arduino"). */
export function frameworkCatalogEntry(id: string): FrameworkCatalogEntry | undefined {
  return FRAMEWORK_CATALOG.find((f) => f.id === id);
}

// ── framework-specific build target + toolchain ─────────────────────────────
// A board's buildTarget string is NOT framework-independent: Arduino uses an
// FQBN (e.g. 'esp32:esp32:esp32s3') while Zephyr uses a board id for
// `west build -b` (e.g. 'esp32s3_devkitc'). The scaffold must pick the right
// one for the chosen framework, and the matching toolchain backend
// ('arduino-cli' vs 'west'). Source for Zephyr board ids: framework-zephyr's
// chip registry (src/chips/index.ts) + the demo configs.

const FRAMEWORK_TOOLCHAIN: Record<string, string> = {
  arduino: "arduino-cli",
  zephyr: "west",
  // native has no toolchain (the native config path writes neither field).
};

/**
 * Zephyr board target for each cuttlefish board id that supports Zephyr. These
 * are the full qualified targets passed to `west build -b <target>` (framework-
 * zephyr's chipForTarget splits on '/' and takes the board id, so the qualified
 * form resolves correctly there too). Zephyr 4.3+ REQUIRES the qualifier for
 * multi-core ESP32 boards — the bare id (e.g. 'esp32s3_devkitc') is rejected
 * with "Board qualifiers ... not found". procpu is the main application core.
 */
const ZEPHYR_BOARD_IDS: Record<string, string> = {
  "esp32-devkit": "esp32_devkitc/esp32/procpu",
  esp32s3: "esp32s3_devkitc/esp32s3/procpu",
  // Single-variant RISC-V board — the bare id is also accepted, but the
  // qualified form is kept for consistency (verified against Zephyr 4.3
  // boards/espressif/esp32c3_devkitm).
  esp32c3: "esp32c3_devkitm/esp32c3",
  // hpcore/lpcore cpucluster variants — the qualified form is required (the
  // bare id is rejected); hpcore is the application core.
  esp32c6: "esp32c6_devkitc/esp32c6/hpcore",
  // First STM32 target — WeAct Black Pill V2.0 (STM32F411CEU6). Single
  // variant; qualified for consistency with every other catalog target.
  "blackpill-f411ce": "blackpill_f411ce/stm32f411xe",
  // First Microchip SAM target — Arduino Nano 33 IoT (SAMD21G18A).
  // Single variant; qualified for consistency with every other target.
  "nano-33-iot": "arduino_nano_33_iot/samd21g18a",
  // nRF52840 (single core), base (non-sense) variant.
  "xiao-nrf52840": "xiao_ble/nrf52840",
  // Raspberry Pi Pico (RP2040) — single-soc board, bare name accepted.
  rp2040: "rpi_pico",
  // Raspberry Pi Pico 2 (RP2350A) — the m33 cpucluster qualifier is required
  // (the board ships hazard3 RISC-V and m33 variants with no default); M33
  // matches the ARM toolchain the rest of the Zephyr targets use.
  rp2350: "rpi_pico2/rp2350a/m33",
};

/**
 * Probe methods per cuttlefish board id, for `cuttlefish create`'s wizard
 * (which runs BEFORE the board package is installed, so it cannot read the
 * package's zephyr field). Ids and descriptions mirror the board packages'
 * probeMethods tables — the consistency test in tests/packages/cuttlefish
 * keeps them in sync; the runtime resolution reads the board package.
 */
export interface CatalogProbeMethod {
  id: string;
  description: string;
}

export const BOARD_PROBE_METHODS: Record<string, CatalogProbeMethod[]> = {
  "blackpill-f411ce": [
    { id: "stlink", description: "ST-Link or any SWD probe openocd supports (no BOOT0 needed) — also debugs" },
    { id: "stlink-srst", description: "ST-Link with the RST/SRST line wired — connect under reset (recovers wedged targets) — also debugs" },
    { id: "dfu", description: "Built-in USB bootloader: hold BOOT0, tap reset (no debug)" },
    { id: "jlink", description: "J-Link probe (SWD) — also debugs" },
  ],
  "nano-33-iot": [
    { id: "bossac", description: "Built-in USB bootloader: double-tap reset, flash over the USB port (no debug)" },
    { id: "openocd", description: "Any CMSIS-DAP-class SWD probe on the underside SWD pads — also debugs" },
    { id: "jlink", description: "J-Link probe (SWD) on the underside SWD pads — also debugs" },
  ],
  "xiao-nrf52840": [
    { id: "jlink", description: "J-Link probe (SWD) — also debugs" },
    { id: "openocd", description: "Any SWD probe openocd supports (CMSIS-DAP, cheap clones) — also debugs" },
    { id: "uf2", description: "Bootloader UF2 drag-and-drop: double-tap reset (no debug)" },
  ],
  rp2040: [
    { id: "uf2", description: "BOOTSEL UF2 bootloader: hold BOOTSEL while plugging in USB (no debug)" },
    { id: "openocd", description: "Any CMSIS-DAP-class SWD probe on the SWD header — also debugs" },
    { id: "jlink", description: "J-Link probe (SWD) — also debugs" },
  ],
  rp2350: [
    { id: "uf2", description: "BOOTSEL UF2 bootloader: hold BOOTSEL while plugging in USB (no debug)" },
    { id: "openocd", description: "Any CMSIS-DAP-class SWD probe on the SWD header (m33 core) — also debugs" },
    { id: "jlink", description: "J-Link probe (SWD) — also debugs" },
  ],
};

/**
 * The probe methods a board offers (wizard/catalog data). Empty when the
 * board has no table — then no probe question is asked and no zephyr.probe
 * section is scaffolded.
 */
export function probeMethodsForBoard(boardId: string | undefined): CatalogProbeMethod[] {
  if (!boardId) return [];
  return BOARD_PROBE_METHODS[boardId] ?? [];
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
  /** The board's Arduino FQBN, as currently stored on KnownTarget. */
  buildTarget?: string;
}

/**
 * Resolve the framework-specific buildTarget + toolchain type for a
 * (board, framework) pair. Arduino reuses the board's FQBN; Zephyr maps to the
 * Zephyr board id; native returns an empty profile (the native config writes
 * neither field).
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
    return { buildTarget: ZEPHYR_BOARD_IDS[target.id], toolchainType };
  }
  // Arduino (and any unlisted framework) → use the board's FQBN.
  return { buildTarget: target.buildTarget, toolchainType };
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

/**
 * Whether `frameworkId` is actually offered for `target`: compatible with the
 * board's architecture AND installable. Auto-picking narrows via
 * frameworksForTarget, but an explicit `--framework` bypasses that narrowing —
 * callers accepting one must reject anything this returns false for (e.g.
 * `--framework arduino` on the Zephyr-only xiao-nrf52840).
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
