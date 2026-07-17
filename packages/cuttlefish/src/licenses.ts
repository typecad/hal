// ---------------------------------------------------------------------------
// @typecad/cuttlefish — Arduino library license scanner
//
// Pure detection core for the `cuttlefish licenses` subcommand. Enumerates
// installed Arduino libraries, resolves each library's SPDX license from
// library.properties and/or the LICENSE file, classifies copyleft risk, and
// returns a sorted list. Never throws. The CLI presenter (runLicenses in
// cli.ts) renders the result and sets process.exitCode.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type CopyleftRisk =
  | "permissive"
  | "weak-copyleft"
  | "strong-copyleft"
  | "unknown";

export type LicenseSource = "library.properties" | "license-file" | "source-header" | "none";

export interface LibraryLicenseEntry {
  name: string;
  version: string | undefined;
  /** install_dir as reported by arduino-cli lib list. */
  path: string;
  /** Normalized SPDX ID (e.g. "BSD-3-Clause"); undefined if not determined. */
  spdx: string | undefined;
  risk: CopyleftRisk;
  source: LicenseSource;
}

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
  display?: { profile?: string; driver?: string; touch?: { library?: string } } | null;
}

/** Angle-bracket #include capture, e.g. '#include <Adafruit_GFX.h>' -> 'Adafruit_GFX.h'. */
const INCLUDE_RE = /^\s*#include\s*<([^>]+)>\s*$/;

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

  // 1. Prefer the generated .ino (authoritative).
  if (entryBase) {
    const outDir = path.resolve(configDir, config.outputOutDir ?? "./out");
    const inoPath = path.join(outDir, entryBase, `${entryBase}.ino`);
    const inoText = readFile(inoPath);
    if (inoText) {
      return { ok: true, headers: parseInoHeaders(inoText), source: "ino", inoPath };
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
 * Join each project header to its owning installed library (resolved) or flag
 * it not-installed. Resolved entries carry the full license entry (license
 * resolved via the existing resolveLibraryLicense).
 */
export function joinHeadersToLibraries(
  headers: string[],
  libs: RawArduinoLibrary[],
  readdir: (d: string) => string[],
  readFile: (p: string) => string | undefined,
): ProjectLibrary[] {
  const index = buildHeaderIndex(libs, readdir);
  return headers.map((header) => {
    const owner = index.get(header);
    if (!owner) return { kind: "not-installed" as const, header };
    const entry = resolveLibraryLicense(owner, readFile, readdir);
    return { kind: "resolved" as const, lib: entry };
  });
}

// ---------------------------------------------------------------------------
// Static SPDX table
// ---------------------------------------------------------------------------

interface SpdxEntry {
  id: string;
  aliases: string[]; // exact-match candidates (lowercased on use)
  risk: CopyleftRisk;
  /** Substrings, ALL of which must appear in the normalized license text. */
  markers: string[];
  /**
   * Short-form phrases for sparse source-header comments where the full license
   * text is absent (e.g. Adafruit's "BSD license, all text here must be
   * included"). ANY one match is sufficient. Lower-cased on use.
   */
  shortMarkers: string[];
}

const SPDX_TABLE: SpdxEntry[] = [
  {
    id: "MIT",
    risk: "permissive",
    aliases: ["MIT", "MIT-0", "Expat"],
    markers: ["permission is hereby granted, free of charge"],
    shortMarkers: ["mit licence", "mit license"],
  },
  {
    id: "BSD-3-Clause",
    risk: "permissive",
    aliases: ["BSD-3", "BSD-3-Clause", "BSD", "New BSD"],
    markers: [
      "redistribution and use in source and binary forms",
      "neither the name",
    ],
    // Adafruit's header convention: "BSD license, all text here/above must be
    // included in any redistribution." Adafruit declares these as BSD-3.
    shortMarkers: ["bsd license, all text", "bsd license. all text"],
  },
  {
    id: "BSD-2-Clause",
    risk: "permissive",
    aliases: ["BSD-2", "BSD-2-Clause", "FreeBSD"],
    markers: [
      "redistribution and use in source and binary forms",
      "redistributions of source code must retain the above copyright notice",
    ],
    shortMarkers: [],
  },
  {
    id: "Apache-2.0",
    risk: "permissive",
    aliases: ["Apache-2.0", "Apache 2.0", "Apache-2", "ASL-2.0"],
    markers: ["apache license", "version 2.0"],
    // ArduinoHttpClient header: "Released under Apache License, version 2.0"
    shortMarkers: ["apache license, version 2.0", "under apache license"],
  },
  {
    id: "LGPL-2.1",
    risk: "weak-copyleft",
    aliases: ["LGPL-2.1", "Lesser GPL 2.1"],
    markers: ["gnu lesser general public license", "version 2.1"],
    // ESP32Servo header: "GNU Lesser General Public ... version 2.1"
    shortMarkers: ["gnu lesser general public", "version 2.1"],
  },
  {
    id: "LGPL-3.0",
    risk: "weak-copyleft",
    aliases: ["LGPL-3.0", "LGPL-3", "LGPL-3.0-only"],
    markers: ["gnu lesser general public license", "version 3"],
    shortMarkers: [],
  },
  {
    id: "GPL-2.0",
    risk: "strong-copyleft",
    aliases: ["GPL-2.0", "GPL-2", "GPLv2"],
    markers: ["gnu general public license", "version 2"],
    shortMarkers: [],
  },
  {
    id: "GPL-3.0",
    risk: "strong-copyleft",
    aliases: ["GPL-3.0", "GPL-3", "GPLv3"],
    markers: ["gnu general public license", "version 3"],
    shortMarkers: [],
  },
  {
    id: "AGPL-3.0",
    risk: "strong-copyleft",
    aliases: ["AGPL-3.0", "AGPL-3", "Affero GPL 3"],
    markers: ["gnu affero general public license"],
    shortMarkers: [],
  },
  {
    id: "Unlicense",
    risk: "permissive",
    aliases: ["Unlicense", "The Unlicense"],
    markers: [
      "this is free and unencumbered software released into the public domain",
    ],
    shortMarkers: [],
  },
  {
    id: "CC-BY-4.0",
    risk: "permissive",
    aliases: ["CC-BY-4.0", "Creative Commons Attribution 4.0", "cc by 4.0"],
    markers: ["creative commons attribution 4.0"],
    shortMarkers: [],
  },
  {
    id: "CC-BY-SA-4.0",
    risk: "strong-copyleft",
    aliases: [
      "CC-BY-SA-4.0",
      "Creative Commons Attribution-ShareAlike 4.0",
      "cc by-sa 4.0",
    ],
    markers: ["creative commons attribution-sharealike 4.0"],
    shortMarkers: [],
  },
  {
    id: "CC-BY-NC-4.0",
    risk: "strong-copyleft",
    aliases: [
      "CC-BY-NC-4.0",
      "Creative Commons Attribution-NonCommercial 4.0",
      "cc by-nc 4.0",
    ],
    markers: ["creative commons attribution-noncommercial 4.0"],
    shortMarkers: [],
  },
];

// ---------------------------------------------------------------------------
// Pure SPDX detection
// ---------------------------------------------------------------------------

/**
 * Normalize license input text for matching: trim, lowercase, strip surrounding
 * quotes/whitespace.
 */
function normalize(input: string): string {
  return input.trim().toLowerCase().replace(/^["']|["']$/g, "");
}

/**
 * Resolve a raw license input (either the short `library.properties` `license=`
 * value, the full text of a LICENSE file, or a source-file header comment) to a
 * canonical SPDX ID.
 *
 * Matching priority:
 *   1. SPDX-License-Identifier: <id> marker (authoritative when present)
 *   2. exact alias match (suits the short properties value)
 *   3. substring markers match, ALL markers required (suits full LICENSE text)
 *   4. shortMarkers match, ANY one sufficient (suits sparse header comments
 *      like Adafruit's "BSD license, all text here must be included")
 *
 * Returns the SPDX ID string, or undefined if nothing matched.
 */
export function identifySpdx(input: string): string | undefined {
  const norm = normalize(input);

  // 1. SPDX-License-Identifier marker — extract the id and alias-match it.
  //    Aliases are stored in their canonical case; compare lowercased.
  const marker = norm.match(/spdx-license-identifier:\s*([^\s\n]+)/);
  if (marker) {
    const id = marker[1].toLowerCase();
    for (const entry of SPDX_TABLE) {
      if (entry.aliases.some((a) => a.toLowerCase() === id)) {
        return entry.id;
      }
    }
  }

  // 2. exact alias match (case-insensitive; `norm` is already lowercased).
  for (const entry of SPDX_TABLE) {
    if (entry.aliases.some((a) => a.toLowerCase() === norm)) {
      return entry.id;
    }
  }

  // 3. substring markers — every marker phrase must appear.
  //    BSD-3 is listed before BSD-2 so its superset clauses (which contain
  //    "neither the name") win over BSD-2's subset.
  for (const entry of SPDX_TABLE) {
    if (entry.markers.every((m) => norm.includes(m))) {
      return entry.id;
    }
  }

  // 4. shortMarkers — ANY one match is sufficient. Used for sparse header
  //    comments where the full license text is absent.
  for (const entry of SPDX_TABLE) {
    if (entry.shortMarkers.some((m) => norm.includes(m))) {
      return entry.id;
    }
  }

  return undefined;
}

/**
 * Classify the copyleft risk of a known SPDX ID. Returns "unknown" for
 * unrecognized ids.
 */
export function classifyRisk(spdx: string): CopyleftRisk {
  const entry = SPDX_TABLE.find((e) => e.id === spdx || e.aliases.includes(spdx));
  return entry ? entry.risk : "unknown";
}

// ---------------------------------------------------------------------------
// Arduino library enumeration (via arduino-cli)
// ---------------------------------------------------------------------------

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

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
 * Candidate LICENSE filenames checked case-insensitively. Includes the British
 * "LICENCE" spelling (e.g. lvgl ships LICENCE.txt).
 */
const LICENSE_FILENAMES = [
  "LICENSE",
  "LICENSE.md",
  "LICENSE.txt",
  "LICENSE.markdown",
  "LICENCE",
  "LICENCE.md",
  "LICENCE.txt",
  "COPYING",
  "COPYING.txt",
];

/**
 * Subdirectories that commonly hold an Arduino library's license file or source
 * headers when the root has neither. Arduino's own libraries (Ethernet,
 * ArduinoHttpClient, ESP32Servo) keep sources under `src/`.
 */
const LICENSE_SUBDIRS = ["src"];

/**
 * Read library.properties from a directory and return its `license=` value
 * (raw, untrimmed) if present.
 */
function readPropertiesLicense(
  installDir: string,
  readFile: (p: string) => string | undefined,
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
 * Read the first LICENSE/COPYING file found in a directory and return its text.
 * Checks the directory itself only (no recursion).
 */
function readLicenseFileIn(
  dir: string,
  readFile: (p: string) => string | undefined,
  readdir: (d: string) => string[],
): string | undefined {
  const entries = new Set(readdir(dir).map((e) => e.toLowerCase()));
  for (const candidate of LICENSE_FILENAMES) {
    if (entries.has(candidate.toLowerCase())) {
      return readFile(path.join(dir, candidate));
    }
  }
  return undefined;
}

/**
 * Read the first LICENSE/COPYING file found in installDir or one of its common
 * subdirectories (e.g. `src/`, where Arduino's own libraries keep it).
 */
function readLicenseFile(
  installDir: string,
  readFile: (p: string) => string | undefined,
  readdir: (d: string) => string[],
): string | undefined {
  return (
    readLicenseFileIn(installDir, readFile, readdir) ??
    ((): string | undefined => {
      for (const sub of LICENSE_SUBDIRS) {
        const text = readLicenseFileIn(path.join(installDir, sub), readFile, readdir);
        if (text) return text;
      }
      return undefined;
    })()
  );
}

/**
 * Extensions whose header comments may carry a license notice (Adafruit and
 * many Arduino libs embed the license at the top of the primary source file
 * rather than in a standalone LICENSE file).
 */
const HEADER_EXTENSIONS = [".h", ".hpp", ".cpp", ".c"];

/**
 * Read the leading header comment of each candidate source file in installDir
 * (and `src/`) and concatenate them, so the SPDX matcher can look for license
 * phrases. The license notice usually lives in the file named after the
 * library itself, so such files are scanned first; then a cap of further
 * headers/sources is scanned to keep this cheap.
 */
function readSourceHeaders(
  libName: string,
  installDir: string,
  readFile: (p: string) => string | undefined,
  readdir: (d: string) => string[],
): string | undefined {
  const dirs = [installDir, ...LICENSE_SUBDIRS.map((s) => path.join(installDir, s))];
  // Normalize the library name into the stem its source files likely use:
  // "Adafruit seesaw Library" -> "adafruit_seesaw".
  const stem = libName.toLowerCase().replace(/\s+library$/, "").replace(/\s+/g, "_");
  const chunks: string[] = [];
  for (const dir of dirs) {
    let entries: string[];
    try {
      entries = readdir(dir);
    } catch {
      continue;
    }
    const sources = entries
      .filter((e) => HEADER_EXTENSIONS.some((ext) => e.toLowerCase().endsWith(ext)))
      // Files whose basename starts with the library stem go first — that is
      // where the license header conventionally lives.
      .sort((a, b) => {
        const aMatch = Number(a.toLowerCase().startsWith(stem));
        const bMatch = Number(b.toLowerCase().startsWith(stem));
        return bMatch - aMatch;
      })
      .slice(0, 6);
    for (const src of sources) {
      const text = readFile(path.join(dir, src));
      if (text) {
        // Take a generous leading window. Most licenses sit in the first few
        // lines, but some .cpp files place the notice after a long copyright
        // preamble (e.g. OneWire.cpp at ~line 99), so 120 lines covers it
        // without reading whole large files.
        chunks.push(text.split(/\r?\n/).slice(0, 120).join("\n"));
      }
    }
  }
  return chunks.length > 0 ? chunks.join("\n") : undefined;
}

/**
 * Resolve a single library's license. Priority: library.properties → LICENSE
 * file → none.
 */
function resolveLibraryLicense(
  lib: RawArduinoLibrary,
  readFile: (p: string) => string | undefined,
  readdir: (d: string) => string[],
): LibraryLicenseEntry {
  const installDir = lib.install_dir ?? "";

  // 1. library.properties
  const propsLicense = readPropertiesLicense(installDir, readFile);
  if (propsLicense) {
    const spdx = identifySpdx(propsLicense);
    if (spdx) {
      return {
        name: lib.name,
        version: lib.version,
        path: installDir,
        spdx,
        risk: classifyRisk(spdx),
        source: "library.properties",
      };
    }
  }

  // 2. LICENSE file (root or src/)
  const fileText = readLicenseFile(installDir, readFile, readdir);
  if (fileText) {
    const spdx = identifySpdx(fileText);
    if (spdx) {
      return {
        name: lib.name,
        version: lib.version,
        path: installDir,
        spdx,
        risk: classifyRisk(spdx),
        source: "license-file",
      };
    }
  }

  // 3. source-file header comments (Adafruit/Arduino pattern: license notice
  //    embedded at the top of the primary .h/.cpp, no standalone LICENSE file).
  const headerText = readSourceHeaders(lib.name, installDir, readFile, readdir);
  if (headerText) {
    const spdx = identifySpdx(headerText);
    if (spdx) {
      return {
        name: lib.name,
        version: lib.version,
        path: installDir,
        spdx,
        risk: classifyRisk(spdx),
        source: "source-header",
      };
    }
  }

  // 4. unknown
  return {
    name: lib.name,
    version: lib.version,
    path: installDir,
    spdx: undefined,
    risk: "unknown",
    source: "none",
  };
}

const RISK_RANK: Record<CopyleftRisk, number> = {
  "strong-copyleft": 0,
  "weak-copyleft": 1,
  permissive: 2,
  unknown: 3,
};

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

// Imported here (not in cli.ts) so the presenter is unit-testable without
// importing the binary entry module cli.ts, which has a shebang and runs
// main() at import time.
import * as ui from "./utils/ui.js";

/**
 * `cuttlefish licenses` presenter: scan installed libraries, render a
 * risk-sorted table, warn on unknowns, and set process.exitCode. Warns (yellow)
 * when a license can't be determined; exits 0 unless `strict` is set or a hard
 * environment failure occurs. Never calls process.exit().
 */
export function runLicensesPresenter(strict: boolean): void {
  ui.printHeader();
  ui.printStep("Checking licenses for installed Arduino libraries");

  const result = scanLicenses();

  if (!result.ok) {
    if (result.reason === "arduino-cli-unresponsive") {
      ui.printError(`arduino-cli .... NOT FOUND or unresponsive`);
      process.exitCode = 1;
    } else {
      // no-libraries — informational, not an error (mirrors doctor's skip path)
      ui.printInfo(`(no libraries installed — nothing to scan)`);
    }
    return;
  }

  // Risk-tagged row rendering.
  const riskBracket = (risk: CopyleftRisk): string => {
    switch (risk) {
      case "strong-copyleft":
        return "  [COPYLEFT]";
      case "weak-copyleft":
        return "  [weak copyleft]";
      default:
        return "";
    }
  };

  for (const lib of result.libraries) {
    if (lib.risk === "unknown") {
      ui.printWarning(`${lib.name} .................. UNKNOWN`);
    } else {
      const spdx = lib.spdx ?? "UNKNOWN";
      const ok = lib.risk === "permissive" ? "  ✓" : "";
      ui.printInfo(`${lib.name} .................. ${spdx}${riskBracket(lib.risk)}${ok}`);
    }
  }

  // Summary counts.
  const counts: Record<CopyleftRisk, number> = {
    permissive: 0,
    "weak-copyleft": 0,
    "strong-copyleft": 0,
    unknown: 0,
  };
  for (const lib of result.libraries) counts[lib.risk] += 1;
  ui.printSuccess(
    `${counts.permissive} permissive, ${counts["weak-copyleft"]} weak copyleft, ` +
      `${counts["strong-copyleft"]} strong copyleft, ${counts.unknown} unknown`,
  );

  // Unknowns detail block.
  const unknowns = result.libraries.filter((l) => l.risk === "unknown");
  if (unknowns.length > 0) {
    ui.printWarning(
      `License could not be determined for ${unknowns.length} ${unknowns.length === 1 ? "library" : "libraries"}:`,
    );
    for (const u of unknowns) {
      ui.printInfo(`    ${u.name} (check library.properties or LICENSE in ${u.path})`);
    }
    if (strict) {
      process.exitCode = 1;
    }
  }
}
