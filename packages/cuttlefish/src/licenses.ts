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

export type LicenseSource = "library.properties" | "license-file" | "none";

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
// Static SPDX table
// ---------------------------------------------------------------------------

interface SpdxEntry {
  id: string;
  aliases: string[]; // exact-match candidates (lowercased on use)
  risk: CopyleftRisk;
  /** Substrings, ALL of which must appear in the normalized license text. */
  markers: string[];
}

const SPDX_TABLE: SpdxEntry[] = [
  {
    id: "MIT",
    risk: "permissive",
    aliases: ["MIT", "MIT-0", "Expat"],
    markers: ["permission is hereby granted, free of charge"],
  },
  {
    id: "BSD-3-Clause",
    risk: "permissive",
    aliases: ["BSD-3", "BSD-3-Clause", "BSD", "New BSD"],
    markers: [
      "redistribution and use in source and binary forms",
      "neither the name",
    ],
  },
  {
    id: "BSD-2-Clause",
    risk: "permissive",
    aliases: ["BSD-2", "BSD-2-Clause", "FreeBSD"],
    markers: [
      "redistribution and use in source and binary forms",
      "redistributions of source code must retain the above copyright notice",
    ],
  },
  {
    id: "Apache-2.0",
    risk: "permissive",
    aliases: ["Apache-2.0", "Apache 2.0", "Apache-2", "ASL-2.0"],
    markers: ["apache license", "version 2.0"],
  },
  {
    id: "LGPL-2.1",
    risk: "weak-copyleft",
    aliases: ["LGPL-2.1", "Lesser GPL 2.1"],
    markers: ["gnu lesser general public license", "version 2.1"],
  },
  {
    id: "LGPL-3.0",
    risk: "weak-copyleft",
    aliases: ["LGPL-3.0", "LGPL-3", "LGPL-3.0-only"],
    markers: ["gnu lesser general public license", "version 3"],
  },
  {
    id: "GPL-2.0",
    risk: "strong-copyleft",
    aliases: ["GPL-2.0", "GPL-2", "GPLv2"],
    markers: ["gnu general public license", "version 2"],
  },
  {
    id: "GPL-3.0",
    risk: "strong-copyleft",
    aliases: ["GPL-3.0", "GPL-3", "GPLv3"],
    markers: ["gnu general public license", "version 3"],
  },
  {
    id: "AGPL-3.0",
    risk: "strong-copyleft",
    aliases: ["AGPL-3.0", "AGPL-3", "Affero GPL 3"],
    markers: ["gnu affero general public license"],
  },
  {
    id: "Unlicense",
    risk: "permissive",
    aliases: ["Unlicense", "The Unlicense"],
    markers: [
      "this is free and unencumbered software released into the public domain",
    ],
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
 * value, or the full text of a LICENSE file) to a canonical SPDX ID.
 *
 * Matching priority:
 *   1. SPDX-License-Identifier: <id> marker (authoritative when present)
 *   2. exact alias match (suits the short properties value)
 *   3. substring markers match, ALL markers required (suits full LICENSE text)
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
 * Candidate LICENSE filenames checked case-insensitively in install_dir.
 */
const LICENSE_FILENAMES = [
  "LICENSE",
  "LICENSE.md",
  "LICENSE.txt",
  "COPYING",
  "COPYING.txt",
];

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
 * Read the first LICENSE/COPYING file found in installDir and return its text.
 */
function readLicenseFile(
  installDir: string,
  readFile: (p: string) => string | undefined,
  readdir: (d: string) => string[],
): string | undefined {
  const entries = new Set(readdir(installDir).map((e) => e.toLowerCase()));
  for (const candidate of LICENSE_FILENAMES) {
    if (entries.has(candidate.toLowerCase())) {
      return readFile(path.join(installDir, candidate));
    }
  }
  return undefined;
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

  // 2. LICENSE file
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

  // 3. unknown
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
