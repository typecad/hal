// ---------------------------------------------------------------------------
// @typecad/framework-arduino — Arduino library license scanner
//
// Arduino-specific enumeration + presenter for the `cuttlefish licenses`
// subcommand. The framework-agnostic SPDX detection engine, LICENSE-file /
// source-header resolution, and copyleft classification live in the shared
// cuttlefish core (`@typecad/cuttlefish/api/shared`); this module owns only
// the Arduino pieces: `arduino-cli lib list` enumeration, project-scope header
// → library resolution, the board-core layout, and the CLI presenter.
//
// This module used to live in @typecad/cuttlefish (Phase 5 decoupling). It was
// moved here because the enumeration is Arduino-specific (it shells out to
// `arduino-cli` and reads Arduino core/library layout). Cuttlefish now
// dispatches the `licenses` command through the loaded framework's `licenses`
// export.
// ---------------------------------------------------------------------------

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import * as ui from "@typecad/cuttlefish/utils/ui";
import { loadCuttlefishConfig } from "@typecad/cuttlefish/config-loader";
import { checkArduinoEnv, deriveRequiredCore } from "@typecad/arduino-cli";
import {
  resolveLibraryLicense as resolveLibraryLicenseShared,
  RISK_RANK,
  riskBracket,
  statusMark,
  countByRisk,
  type LibraryLicenseEntry,
  type ReadFile,
  type ReadDir,
} from "@typecad/cuttlefish/api/shared";

// ---------------------------------------------------------------------------
// Public types (SPDX core re-exported from the shared cuttlefish core)
// ---------------------------------------------------------------------------

// Re-export the detection functions + types so existing callers and tests that
// import them from this module keep working (the canonical home is now the
// shared core).
export { identifySpdx, classifyRisk } from "@typecad/cuttlefish/api/shared";
export type { CopyleftRisk, LicenseSource, LibraryLicenseEntry } from "@typecad/cuttlefish/api/shared";

export type ScanOutcome =
  | { ok: true; libraries: LibraryLicenseEntry[] }
  | {
      ok: false;
      reason: "arduino-cli-not-found" | "arduino-cli-unresponsive" | "no-libraries";
      message: string;
    };

// ---------------------------------------------------------------------------
// Project-scope resolution
// ---------------------------------------------------------------------------

/**
 * Headers the project needs. `source` is "ino" when read from the generated
 * .ino (authoritative) or "config" when derived from cuttlefish.config.ts
 * (partial: display/touch only).
 */
export type ProjectHeaders =
  | { ok: true; headers: string[]; source: "ino" | "config"; inoPath?: string }
  | { ok: false; reason: "no-config" | "no-entry" | "unreadable-ino"; message: string };

/**
 * Minimal view of ResolvedCuttlefishConfig that resolveProjectHeaders needs.
 * Kept structural so we don't import the full config type (avoids a cycle).
 */
interface ProjectConfig {
  configPath: string;
  entry?: string;
  outputOutDir?: string;
  /** FQBN, e.g. 'arduino:avr:uno'. Used to resolve the board core for core-bundled libs. */
  buildTarget?: string;
  display?: { profile?: string; driver?: string; touch?: { library?: string } } | null;
}

/**
 * #include capture for both angle-bracket and quote forms. Returns the bare
 * header name, e.g. '#include <Adafruit_GFX.h>' or '#include "Servo.h"' -> the
 * captured header. Quote includes with a path separator (e.g. "./foo.h",
 * "../util/bar.h") are project-relative and excluded by the second regex.
 */
const INCLUDE_RE = /^\s*#include\s*[<"]([^>"]+)[>"]\s*$/;

/** System/stdlib headers that are never Arduino libraries. Matched verbatim. */
const SYSTEM_HEADERS = new Set([
  "Arduino.h",
  "stdio.h",
  "stdlib.h",
  "string.h",
  "stdint.h",
  "Esp.h",
  "math.h",
  "avr/pgmspace.h",
]);

/**
 * Header prefixes that come from the compiler toolchain's C library
 * (avr-libc, newlib), not from any installable Arduino library. Such headers
 * are present on the system (via the toolchain) and should be reported as
 * CORE/TOOLCHAIN rather than NOT INSTALLED. Deliberately conservative — only
 * confident patterns; anything else still surfaces as not-installed.
 */
const TOOLCHAIN_HEADER_PREFIXES = ["avr/", "util/"];

/** Classify a header as a compiler-toolchain C-library header. */
export function isToolchainHeader(header: string): boolean {
  return TOOLCHAIN_HEADER_PREFIXES.some((p) => header.toLowerCase().startsWith(p));
}

/**
 * Result of resolving the project's board core directory.
 */
export type ProjectCore =
  | { ok: true; coreDir: string }
  | { ok: false; reason: "no-fqbn" | "no-core"; message: string };

/**
 * Compare two version strings as semver (major.minor.patch). Falls back to
 * lexical comparison when either isn't a clean semver.
 */
function compareVersion(a: string, b: string): number {
  const pa = a.split(".").map((n) => Number(n));
  const pb = b.split(".").map((n) => Number(n));
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const va = pa[i] ?? 0;
    const vb = pb[i] ?? 0;
    if (va !== vb) return va - vb;
  }
  return a.localeCompare(b);
}

/**
 * Resolve the project's board-core directory from its FQBN, via
 * `arduino-cli config dump` (for the packages data dir) and the on-disk
 * `<data>/packages/<packager>/hardware/<arch>/<version>/` layout. Returns the
 * highest-versioned core dir. Never throws.
 *
 * `runConfigDump` is an injected seam (returns the `config dump` stdout, or ""
 * on failure) so the function is unit-testable without spawning.
 */
export function resolveProjectCore(
  fqbn: string | undefined,
  runConfigDump: () => string,
  readdir: (d: string) => string[],
): ProjectCore {
  const coreId = deriveRequiredCore(fqbn);
  if (!coreId) {
    return { ok: false, reason: "no-fqbn", message: "No buildTarget (FQBN) in config." };
  }
  const [packager, arch] = coreId.split(":");

  let dataDir: string | undefined;
  try {
    const stdout = runConfigDump();
    if (stdout) {
      const parsed = JSON.parse(stdout);
      dataDir = parsed?.config?.directories?.data;
    }
  } catch {
    // fall through to no-core
  }
  if (!dataDir) {
    return { ok: false, reason: "no-core", message: "Could not read arduino-cli data directory." };
  }

  const hardwareDir = path.join(dataDir, "packages", packager, "hardware", arch);
  let versions: string[];
  try {
    versions = readdir(hardwareDir);
  } catch {
    return { ok: false, reason: "no-core", message: `No core versions at ${hardwareDir}.` };
  }
  if (versions.length === 0) {
    return { ok: false, reason: "no-core", message: `No core versions at ${hardwareDir}.` };
  }
  versions.sort((a, b) => compareVersion(b, a)); // descending
  return { ok: true, coreDir: path.join(hardwareDir, versions[0]) };
}

/**
 * Static driver -> library-header mapping for the config fallback. Mirrors the
 * `includes` each display adapter emits (those strings are static per driver —
 * verified against the adapters in api/shared/display-adapter*.ts). Kept here
 * rather than calling generateDisplayAdapter() so the fallback doesn't need to
 * construct a full ResolvedDisplay (which requires resolved mount pins).
 */
const DRIVER_HEADERS: Record<string, string[]> = {
  ili9341: ["Adafruit_GFX.h", "Adafruit_ILI9341.h"],
  st7796: ["Adafruit_GFX.h", "Adafruit_ST7796S.h"],
  ssd1309: ["Adafruit_GFX.h", "Adafruit_SSD1306.h"],
  ssd1680: ["Adafruit_EPD.h"],
  sdl: [],
};

/**
 * Built-in touch library -> header, mirroring generateTouchAdapter()'s includes.
 */
const TOUCH_HEADERS: Record<string, string[]> = {
  XPT2046_Touchscreen: ["XPT2046_Touchscreen.h"],
  Adafruit_TouchScreen: ["TouchScreen.h"],
  Adafruit_STMPE610: ["Adafruit_STMPE610.h"],
  FT6336U: ["Wire.h", "RAK14014_FT6336U.h"],
  sdl: ["SDL2/SDL.h"],
};

/** Pull library header names out of an .ino's text. */
function parseInoHeaders(inoText: string): string[] {
  const headers: string[] = [];
  for (const line of inoText.split(/\r?\n/)) {
    const m = line.match(INCLUDE_RE);
    if (m && !SYSTEM_HEADERS.has(m[1])) headers.push(m[1]);
  }
  return headers;
}

/**
 * Resolve the project's library headers. Prefers the generated .ino
 * (authoritative); falls back to display/touch headers derived from config
 * (partial picture, no transpile required).
 */
export function resolveProjectHeaders(
  config: ProjectConfig | undefined,
  readFile: (p: string) => string | undefined,
): ProjectHeaders {
  if (!config) {
    return { ok: false, reason: "no-config", message: "No cuttlefish.config.ts found." };
  }
  const configDir = path.dirname(config.configPath);
  const entryBase = config.entry ? path.basename(config.entry).replace(/\.[tj]s$/, "") : "";

  // 1. Prefer the generated .ino (authoritative). The outDir is resolved
  // relative to the entry's directory, matching the transpile path
  // (transpile.ts:280 -> outBaseDir defaults to the entry dir, and cli.ts
  // resolves config.outputOutDir against inputDir = entry dir).
  if (entryBase) {
    const entryDir = path.dirname(path.resolve(configDir, config.entry!));
    const outDir = path.resolve(entryDir, config.outputOutDir ?? "./out");
    const inoPath = path.join(outDir, entryBase, `${entryBase}.ino`);
    const inoText = readFile(inoPath);
    if (inoText) {
      const parsed = parseInoHeaders(inoText);
      // Drop project-local headers: a header co-located with the .ino (e.g. a
      // cuttlefish-emitted polyfill like sht30.h) is project code, not a
      // missing library — it must not be reported as NOT INSTALLED.
      const inoDir = path.dirname(inoPath);
      const headers = parsed.filter((h) => readFile(path.join(inoDir, h)) === undefined);
      return { ok: true, headers, source: "ino", inoPath };
    }
  }

  // 2. Fallback: derive display + touch headers from config (partial picture).
  const headers: string[] = [];
  const driver = config.display?.driver;
  if (driver && DRIVER_HEADERS[driver]) {
    headers.push(...DRIVER_HEADERS[driver]);
  }
  const touchLib = config.display?.touch?.library;
  if (touchLib && TOUCH_HEADERS[touchLib]) {
    headers.push(...TOUCH_HEADERS[touchLib]);
  }
  if (headers.length > 0) {
    return { ok: true, headers, source: "config" };
  }

  // 3. Nothing to go on.
  return {
    ok: false,
    reason: "no-entry",
    message: entryBase
      ? "No generated .ino and no display config. Run 'cuttlefish build'."
      : "No entry point in config.",
  };
}

/**
 * One project header, joined to its owning library or flagged not-installed.
 */
export type ProjectLibrary =
  | { kind: "resolved"; lib: LibraryLicenseEntry }
  | { kind: "core"; header: string }
  | { kind: "not-installed"; header: string };

/**
 * Build a header-basename -> owning library map from the installed libraries,
 * scanning each install_dir root and its `src/` subdir for .h/.hpp files.
 */
function buildHeaderIndex(
  libs: RawArduinoLibrary[],
  readdir: (d: string) => string[],
): Map<string, RawArduinoLibrary> {
  const index = new Map<string, RawArduinoLibrary>();
  const dirs = (installDir: string) => [installDir, ...LICENSE_SUBDIRS.map((s) => path.join(installDir, s))];
  for (const lib of libs) {
    if (!lib.install_dir) continue;
    for (const dir of dirs(lib.install_dir)) {
      let entries: string[];
      try {
        entries = readdir(dir);
      } catch {
        continue;
      }
      for (const entry of entries) {
        const lower = entry.toLowerCase();
        if (lower.endsWith(".h") || lower.endsWith(".hpp")) {
          if (!index.has(entry)) index.set(entry, lib); // first-wins
        }
      }
    }
  }
  return index;
}

/**
 * Build a header-basename -> bundled-library map from a board core's bundled
 * libraries. Scans `<coreDir>/libraries/<Lib>/src/` for .h files (e.g. Wire.h,
 * SPI.h). Each header maps to a synthetic RawArduinoLibrary so the existing
 * resolveLibraryLicense can read its license from the bundled lib's header
 * notice or library.properties.
 */
export function buildCoreHeaderIndex(
  coreDir: string,
  readdir: (d: string) => string[],
): Map<string, RawArduinoLibrary> {
  const index = new Map<string, RawArduinoLibrary>();
  const libsDir = path.join(coreDir, "libraries");
  let libNames: string[];
  try {
    libNames = readdir(libsDir);
  } catch {
    return index;
  }
  for (const libName of libNames) {
    const srcDir = path.join(libsDir, libName, "src");
    let headers: string[];
    try {
      headers = readdir(srcDir);
    } catch {
      continue;
    }
    const synthetic: RawArduinoLibrary = {
      name: libName,
      install_dir: path.join(libsDir, libName),
    };
    for (const entry of headers) {
      const lower = entry.toLowerCase();
      if ((lower.endsWith(".h") || lower.endsWith(".hpp")) && !index.has(entry)) {
        index.set(entry, synthetic);
      }
    }
  }
  return index;
}

/**
 * Join each project header to its owning library or classify it. Pipeline:
 *   1. user library (arduino-cli lib list)  -> resolved (license)
 *   2. core library (project's own core)    -> resolved (license, e.g. LGPL-2.1)
 *   3. toolchain header (avr/*, util/*)     -> core (gray, no license)
 *   4. else                                  -> not-installed
 *
 * `coreDir` is optional; when absent, step 2 is skipped.
 */
export function joinHeadersToLibraries(
  headers: string[],
  libs: RawArduinoLibrary[],
  readdir: (d: string) => string[],
  readFile: (p: string) => string | undefined,
  coreDir?: string,
): ProjectLibrary[] {
  const userIndex = buildHeaderIndex(libs, readdir);
  const coreIndex = coreDir ? buildCoreHeaderIndex(coreDir, readdir) : new Map<string, RawArduinoLibrary>();
  return headers.map((header) => {
    // 1. user library
    const userOwner = userIndex.get(header);
    if (userOwner) {
      return { kind: "resolved" as const, lib: resolveLibraryLicense(userOwner, readFile, readdir) };
    }
    // 2. core library
    const coreOwner = coreIndex.get(header);
    if (coreOwner) {
      return { kind: "resolved" as const, lib: resolveLibraryLicense(coreOwner, readFile, readdir) };
    }
    // 3. toolchain header
    if (isToolchainHeader(header)) {
      return { kind: "core" as const, header };
    }
    // 4. not installed
    return { kind: "not-installed" as const, header };
  });
}

// ---------------------------------------------------------------------------
// Arduino library enumeration (via arduino-cli)
// ---------------------------------------------------------------------------

/** Raw library entry as it appears in `arduino-cli lib list --format json`. */
export interface RawArduinoLibrary {
  name: string;
  version?: string;
  install_dir?: string;
}

/** Wrapped (newer) shape: { installed_libraries: [{ library: {...} }] }. */
interface WrappedLibList {
  installed_libraries?: { library: RawArduinoLibrary }[];
}

/**
 * Subdirectories that commonly hold an Arduino library's license file or source
 * headers when the root has neither. Arduino's own libraries (Ethernet,
 * ArduinoHttpClient, ESP32Servo) keep sources under `src/`.
 */
const LICENSE_SUBDIRS = ["src"];

/**
 * Read library.properties from a directory and return its `license=` value
 * (raw, untrimmed) if present. Wired into the shared resolver as the manifest
 * reader; the manifest-source label is `"library.properties"` for Arduino parity.
 */
function readPropertiesLicense(
  installDir: string,
  readFile: ReadFile,
): string | undefined {
  const text = readFile(path.join(installDir, "library.properties"));
  if (!text) return undefined;
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*license\s*=\s*(.*)$/);
    if (m && m[1].trim()) return m[1];
  }
  return undefined;
}

/**
 * Resolve a single Arduino library's license via the shared core. Priority
 * (owned by the shared resolver): library.properties → LICENSE file →
 * source-file header comments → none. Maps the arduino-cli `install_dir` shape
 * to the neutral `installDir` the shared resolver expects.
 */
function resolveLibraryLicense(
  lib: RawArduinoLibrary,
  readFile: ReadFile,
  readdir: ReadDir,
): LibraryLicenseEntry {
  return resolveLibraryLicenseShared(
    { name: lib.name, version: lib.version, installDir: lib.install_dir },
    readFile,
    readdir,
    {
      subdirs: LICENSE_SUBDIRS,
      readManifestLicense: readPropertiesLicense,
      manifestSourceLabel: "library.properties",
    },
  );
}

/**
 * Run `arduino-cli lib list --format json` and parse both known shapes into a
 * flat list. Returns null on spawn failure or unparseable output (mirrors the
 * null-on-error convention from framework-arduino/src/lib-discovery.ts).
 */
function listLibraries(): RawArduinoLibrary[] | null {
  try {
    const result = spawnSync("arduino-cli", ["lib", "list", "--format", "json"], {
      encoding: "utf8",
      timeout: 30000,
    });
    if (result.error || result.status !== 0) return null;
    const output = result.stdout?.trim();
    if (!output) return null;
    const parsed: unknown = JSON.parse(output);
    return coerceLibList(parsed);
  } catch {
    return null;
  }
}

/**
 * Normalize either JSON shape (wrapped or bare array) to a flat library list.
 * Exported for direct unit testing of the dual-shape parsing.
 */
export function coerceLibList(parsed: unknown): RawArduinoLibrary[] {
  if (Array.isArray(parsed)) {
    return parsed as RawArduinoLibrary[];
  }
  if (typeof parsed === "object" && parsed !== null) {
    const wrapped = parsed as WrappedLibList;
    if (wrapped.installed_libraries && Array.isArray(wrapped.installed_libraries)) {
      return wrapped.installed_libraries.map((item) => item.library);
    }
  }
  return [];
}

/**
 * Module-level runner override used by presenter tests so `scanLicenses()`
 * (with no args) does not spawn. Mirrors __setArduinoCliRunnerForTest.
 */
export interface LicensesRunner {
  listLibraries: () => RawArduinoLibrary[] | null;
  readFile: (p: string) => string | undefined;
  readdir: (d: string) => string[];
}

let testRunner: LicensesRunner | undefined;

/** @internal Test-only override of the default runner. */
export function __setLicensesRunnerForTest(runner: LicensesRunner | undefined): void {
  testRunner = runner;
}

/**
 * Options for `scanLicenses`. Production calls omit this object entirely; tests
 * inject `fakeLibList` and `fakeReadFile` to avoid spawning and disk I/O.
 */
export interface ScanOptions {
  /** Override the `arduino-cli lib list` call. Return null to simulate spawn failure. */
  fakeLibList?: () => RawArduinoLibrary[] | null;
  /** Override disk reads of library.properties and LICENSE files. */
  fakeReadFile?: (p: string) => string | undefined;
  /** Override directory listings. */
  fakeReaddir?: (d: string) => string[];
}

/**
 * Scan installed Arduino libraries and resolve each one's license. Never throws.
 */
export function scanLicenses(options?: ScanOptions): ScanOutcome {
  const listRunner = options?.fakeLibList ?? testRunner?.listLibraries ?? listLibraries;
  const readFile =
    options?.fakeReadFile ??
    testRunner?.readFile ??
    ((p: string) => {
      try {
        return fs.readFileSync(p, "utf8");
      } catch {
        return undefined;
      }
    });
  const readdir =
    options?.fakeReaddir ??
    testRunner?.readdir ??
    ((d: string) => {
      try {
        return fs.readdirSync(d);
      } catch {
        return [];
      }
    });

  const libs = listRunner();
  if (libs === null) {
    return {
      ok: false,
      reason: "arduino-cli-unresponsive",
      message: "arduino-cli did not return a library list.",
    };
  }
  if (libs.length === 0) {
    return {
      ok: false,
      reason: "no-libraries",
      message: "No Arduino libraries are installed.",
    };
  }

  const entries = libs
    .filter((lib) => lib.name && lib.install_dir)
    .map((lib) => resolveLibraryLicense(lib, readFile, readdir));

  entries.sort((a, b) => {
    const r = RISK_RANK[a.risk] - RISK_RANK[b.risk];
    if (r !== 0) return r;
    return a.name.toLowerCase().localeCompare(b.name.toLowerCase());
  });

  return { ok: true, libraries: entries };
}

// ---------------------------------------------------------------------------
// CLI presenter
// ---------------------------------------------------------------------------

let testProjectConfig: ProjectConfig | undefined;

/** @internal Test-only override of the project config (normally loaded via loadCuttlefishConfig). */
export function __setProjectConfigForTest(config: ProjectConfig | undefined): void {
  testProjectConfig = config;
}

let testConfigDump: (() => string) | undefined;

/** @internal Test-only override of `arduino-cli config dump` stdout. */
export function __setConfigDumpForTest(fn: (() => string) | undefined): void {
  testConfigDump = fn;
}

/**
 * `cuttlefish licenses` presenter. `all === false` (default, project scope)
 * resolves this project's libraries from the generated .ino (or config
 * fallback), joins each to an installed library, and reports only those.
 * `all === true` reports every installed library (the original behavior).
 * Warns on unknown licenses; flags NOT INSTALLED headers in project scope; sets
 * process.exitCode under --strict. Never calls process.exit().
 */
export function runLicensesPresenter(strict: boolean, all: boolean): void {
  ui.printHeader();

  if (all) {
    runAllScope(strict);
    return;
  }
  runProjectScope(strict);
}

/** Original system-wide behavior: scan every installed library. */
function runAllScope(strict: boolean): void {
  ui.printStep("Checking licenses for all installed Arduino libraries");
  renderAllLicenses(scanLicenses(), strict);
}

/** Project scope: resolve this project's headers, join, render. */
function runProjectScope(strict: boolean): void {
  const config = testProjectConfig ?? loadProjectConfig();
  const readFile = testRunner?.readFile ?? makeDefaultReadFile();
  const headers = resolveProjectHeaders(config, readFile);
  if (!headers.ok) {
    ui.printStep("Checking licenses for this project");
    if (headers.reason === "no-config") {
      ui.printInfo(`(no cuttlefish.config.ts found — run from a project dir, or use 'cuttlefish licenses --all')`);
    } else {
      ui.printInfo(`(${headers.message})`);
    }
    return;
  }

  const label =
    headers.source === "ino" && headers.inoPath
      ? `Checking licenses for this project (from ${relFromCwd(headers.inoPath)})`
      : "Checking licenses for this project (from cuttlefish.config.ts — run 'cuttlefish build' for the full set)";
  ui.printStep(label);

  const listRunner = testRunner?.listLibraries ?? listLibraries;
  const libs = listRunner();
  if (libs === null) {
    ui.printError(`arduino-cli .... NOT FOUND or unresponsive`);
    process.exitCode = 1;
    return;
  }
  const readdir = testRunner?.readdir ?? makeDefaultReaddir();
  // Resolve the project's board core (for core-bundled libs like Wire). Best-effort:
  // on any failure, skip the core-index step.
  const configDump = testConfigDump ?? makeDefaultConfigDump();
  const core = resolveProjectCore(config?.buildTarget, configDump, readdir);
  const coreDir = core.ok ? core.coreDir : undefined;
  const project = joinHeadersToLibraries(headers.headers, libs, readdir, readFile, coreDir);

  const resolved = project.filter(
    (p): p is { kind: "resolved"; lib: LibraryLicenseEntry } => p.kind === "resolved",
  );
  const notInstalled = project.filter(
    (p): p is { kind: "not-installed"; header: string } => p.kind === "not-installed",
  );

  // Sort resolved by risk, then name.
  resolved.sort((a, b) => {
    const r = RISK_RANK[a.lib.risk] - RISK_RANK[b.lib.risk];
    if (r !== 0) return r;
    return a.lib.name.toLowerCase().localeCompare(b.lib.name.toLowerCase());
  });

  for (const r of resolved) {
    const lib = r.lib;
    if (lib.risk === "unknown") {
      ui.printWarning(`${lib.name} .................. UNKNOWN`);
    } else {
      ui.printInfo(`${lib.name} .................. ${lib.spdx ?? "UNKNOWN"}${riskBracket(lib.risk)}${statusMark(lib.risk)}`);
    }
  }
  for (const ni of notInstalled) {
    ui.printError(`${ni.header} .................. NOT INSTALLED`);
  }
  const coreHeaders = project.filter(
    (p): p is { kind: "core"; header: string } => p.kind === "core",
  );
  for (const c of coreHeaders) {
    ui.printInfo(`${c.header} ... CORE/TOOLCHAIN`);
  }

  const counts = countByRisk(resolved.map((r) => r.lib));
  ui.printSuccess(
    `${counts.permissive} permissive, ${counts["weak-copyleft"]} weak copyleft, ` +
      `${counts["strong-copyleft"]} strong copyleft, ${counts.unknown} unknown` +
      (notInstalled.length > 0 ? `; ${notInstalled.length} not installed` : ""),
  );

  const unknowns = resolved.filter((r) => r.lib.risk === "unknown").map((r) => r.lib);
  if (unknowns.length > 0) {
    ui.printWarning(
      `License could not be determined for ${unknowns.length} ${unknowns.length === 1 ? "library" : "libraries"}:`,
    );
    for (const u of unknowns) {
      ui.printInfo(`    ${u.name} (check library.properties or LICENSE in ${u.path})`);
    }
  }

  if (notInstalled.length > 0) {
    ui.printError(
      `${notInstalled.length} project ${notInstalled.length === 1 ? "dependency is" : "dependencies are"} not installed:`,
    );
    for (const ni of notInstalled) {
      ui.printInfo(`    ${ni.header} (no installed Arduino library provides this header)`);
    }
  }

  if ((unknowns.length > 0 || notInstalled.length > 0) && strict) {
    process.exitCode = 1;
  }
}

/** Render the --all scope's scanLicenses outcome. */
function renderAllLicenses(result: ScanOutcome, strict: boolean): void {
  if (!result.ok) {
    if (result.reason === "arduino-cli-unresponsive") {
      ui.printError(`arduino-cli .... NOT FOUND or unresponsive`);
      process.exitCode = 1;
    } else {
      ui.printInfo(`(no libraries installed — nothing to scan)`);
    }
    return;
  }
  const counts = countByRisk(result.libraries);
  for (const lib of result.libraries) {
    if (lib.risk === "unknown") {
      ui.printWarning(`${lib.name} .................. UNKNOWN`);
    } else {
      ui.printInfo(`${lib.name} .................. ${lib.spdx ?? "UNKNOWN"}${riskBracket(lib.risk)}${statusMark(lib.risk)}`);
    }
  }
  ui.printSuccess(
    `${counts.permissive} permissive, ${counts["weak-copyleft"]} weak copyleft, ` +
      `${counts["strong-copyleft"]} strong copyleft, ${counts.unknown} unknown`,
  );
  const unknowns = result.libraries.filter((l) => l.risk === "unknown");
  if (unknowns.length > 0) {
    ui.printWarning(
      `License could not be determined for ${unknowns.length} ${unknowns.length === 1 ? "library" : "libraries"}:`,
    );
    for (const u of unknowns) {
      ui.printInfo(`    ${u.name} (check library.properties or LICENSE in ${u.path})`);
    }
    if (strict) process.exitCode = 1;
  }
}

function relFromCwd(p: string): string {
  return path.relative(process.cwd(), p) || p;
}
function loadProjectConfig(): ProjectConfig | undefined {
  // loadCuttlefishConfig walks up from cwd for cuttlefish.config.ts.
  return loadCuttlefishConfig(process.cwd()) as ProjectConfig | undefined;
}
function makeDefaultReadFile(): (p: string) => string | undefined {
  return (p) => {
    try {
      return fs.readFileSync(p, "utf8");
    } catch {
      return undefined;
    }
  };
}
function makeDefaultReaddir(): (d: string) => string[] {
  return (d) => {
    try {
      return fs.readdirSync(d);
    } catch {
      return [];
    }
  };
}
function makeDefaultConfigDump(): () => string {
  return () => {
    try {
      const result = spawnSync("arduino-cli", ["config", "dump", "--format", "json"], {
        encoding: "utf8",
        timeout: 30000,
      });
      if (result.error || result.status !== 0) return "";
      return result.stdout ?? "";
    } catch {
      return "";
    }
  };
}
