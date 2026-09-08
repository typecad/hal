// ---------------------------------------------------------------------------
// Shared SPDX license-detection core
//
// Framework-agnostic license resolution for the `typecad-hal licenses` command.
// The pure detection engine (SPDX table, marker matching, copyleft
// classification) and the file-based license resolver (LICENSE file + source
// header comments + an injected manifest reader) live here so every framework
// package can reuse them. Each framework supplies only its own dependency
// enumeration (package-manager listings, west list, …) and a manifest reader, then
// calls resolveLibraryLicense.
//
// Nothing here imports a framework package or shells out to a toolchain: all
// filesystem access is through injected readFile/readdir seams, so the core is
// deterministic and unit-testable without spawning.
// ---------------------------------------------------------------------------

import path from "node:path";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type CopyleftRisk =
  | "permissive"
  | "weak-copyleft"
  | "strong-copyleft"
  | "unknown";

/**
 * Where a license declaration was found.
 *
 * `"library.properties"` is the Arduino-ecosystem library-manifest form (kept
 * verbatim for packages that carry one); `"manifest"` is the framework-neutral form for any
 * other manifest reader a framework supplies (e.g. a west module.yml).
 */
export type LicenseSource =
  | "library.properties"
  | "manifest"
  | "license-file"
  | "source-header"
  | "none";

/**
 * A resolved license row for a single dependency. Frameworks render this into
 * their own CLI tables.
 */
export interface LibraryLicenseEntry {
  name: string;
  version: string | undefined;
  /** Install/root directory of the dependency (where its LICENSE lives). */
  path: string;
  /** Normalized SPDX ID (e.g. "BSD-3-Clause"); undefined if not determined. */
  spdx: string | undefined;
  risk: CopyleftRisk;
  source: LicenseSource;
}

/**
 * Neutral dependency shape every framework adapts its enumeration to.
 * Package-manager listings map `{ name, version, install_dir }` →
 * `{ name, version, installDir }`; Zephyr maps a west-listed project
 * (`{ name, abspath }`) the same way.
 */
export interface DiscoveredDependency {
  name: string;
  version?: string;
  /** Absolute path to the dependency's install/root directory. */
  installDir?: string;
}

/** Injected file reader (returns undefined on missing/unreadable). */
export type ReadFile = (p: string) => string | undefined;
/** Injected directory lister (returns [] on missing/unreadable). */
export type ReadDir = (d: string) => string[];

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

export const SPDX_TABLE: readonly SpdxEntry[] = [
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
    aliases: ["LGPL-2.1", "LGPL-2.1-only", "LGPL-2.1-or-later", "Lesser GPL 2.1"],
    markers: ["gnu lesser general public license", "version 2.1"],
    // ESP32Servo header: "GNU Lesser General Public ... version 2.1"
    shortMarkers: ["gnu lesser general public", "version 2.1"],
  },
  {
    id: "LGPL-3.0",
    risk: "weak-copyleft",
    aliases: ["LGPL-3.0", "LGPL-3", "LGPL-3.0-only", "LGPL-3.0-or-later"],
    markers: ["gnu lesser general public license", "version 3"],
    shortMarkers: [],
  },
  {
    id: "GPL-2.0",
    risk: "strong-copyleft",
    aliases: ["GPL-2.0", "GPL-2", "GPLv2", "GPL-2.0-only", "GPL-2.0-or-later"],
    markers: ["gnu general public license", "version 2"],
    shortMarkers: [],
  },
  {
    id: "GPL-3.0",
    risk: "strong-copyleft",
    aliases: ["GPL-3.0", "GPL-3", "GPLv3", "GPL-3.0-only", "GPL-3.0-or-later"],
    markers: ["gnu general public license", "version 3"],
    shortMarkers: [],
  },
  {
    id: "AGPL-3.0",
    risk: "strong-copyleft",
    aliases: ["AGPL-3.0", "AGPL-3", "Affero GPL 3", "AGPL-3.0-only", "AGPL-3.0-or-later"],
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

export const RISK_RANK: Record<CopyleftRisk, number> = {
  "strong-copyleft": 0,
  "weak-copyleft": 1,
  permissive: 2,
  unknown: 3,
};

/**
 * Candidate LICENSE filenames checked case-insensitively. Includes the British
 * "LICENCE" spelling (e.g. lvgl ships LICENCE.txt) and the `.rst`
 * (reStructuredText) form common in Zephyr/Linux modules (e.g.
 * trusted-firmware-m ships `license.rst`).
 *
 * Deliberately does NOT match per-component `COPYING.<spec>` files (e.g.
 * picolibc's COPYING.GPL2 / COPYING.NEWLIB / COPYING.picolibc): those name a
 * specific license rather than the project license, and matching COPYING.GPL2
 * would falsely flag a BSD project as strong-copyleft.
 */
export const LICENSE_FILENAMES: readonly string[] = [
  "LICENSE",
  "LICENSE.md",
  "LICENSE.txt",
  "LICENSE.markdown",
  "LICENSE.rst",
  "LICENCE",
  "LICENCE.md",
  "LICENCE.txt",
  "LICENCE.rst",
  "COPYING",
  "COPYING.txt",
  "COPYING.rst",
];

/**
 * Extensions whose header comments may carry a license notice (Adafruit and
 * many libraries embed the license at the top of the primary source file
 * rather than in a standalone LICENSE file).
 */
const HEADER_EXTENSIONS = [".h", ".hpp", ".cpp", ".c"];

// ---------------------------------------------------------------------------
// Pure SPDX detection
// ---------------------------------------------------------------------------

/**
 * Normalize license input text for matching: trim, lowercase, strip surrounding
 * quotes/whitespace.
 */
export function normalize(input: string): string {
  return input.trim().toLowerCase().replace(/^["']|["']$/g, "");
}

/**
 * Resolve a raw license input (either a short manifest value, the full text of
 * a LICENSE file, or a source-file header comment) to a canonical SPDX ID.
 *
 * Matching priority:
 *   1. SPDX-License-Identifier: <id> marker (authoritative when present)
 *   2. exact alias match (suits the short manifest value)
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
// License-file / source-header readers (pure I/O via injected seams)
// ---------------------------------------------------------------------------

/**
 * Read the first LICENSE/COPYING file found in a directory and return its text.
 * Checks the directory itself only (no recursion). The match is
 * case-insensitive, but the file is read using its REAL on-disk name (not the
 * canonical candidate) so it works on case-sensitive filesystems where a module
 * ships e.g. `license.rst` rather than `LICENSE.rst`.
 */
export function readLicenseFileIn(
  dir: string,
  readFile: ReadFile,
  readdir: ReadDir,
): string | undefined {
  // Map each entry's lowercased name back to its real (on-disk) casing.
  const lowered = new Map<string, string>();
  for (const e of readdir(dir)) lowered.set(e.toLowerCase(), e);
  for (const candidate of LICENSE_FILENAMES) {
    const actual = lowered.get(candidate.toLowerCase());
    if (actual !== undefined) {
      return readFile(path.join(dir, actual));
    }
  }
  return undefined;
}

/**
 * Read the first LICENSE/COPYING file found in installDir or one of its common
 * subdirectories (e.g. `src/`, where Arduino's own libraries keep it).
 */
export function readLicenseFile(
  installDir: string,
  readFile: ReadFile,
  readdir: ReadDir,
  subdirs: readonly string[] = ["src"],
): string | undefined {
  const rootHit = readLicenseFileIn(installDir, readFile, readdir);
  if (rootHit) return rootHit;
  for (const sub of subdirs) {
    const text = readLicenseFileIn(path.join(installDir, sub), readFile, readdir);
    if (text) return text;
  }
  return undefined;
}

/**
 * Read the leading header comment of each candidate source file in installDir
 * (and its subdirs) and concatenate them, so the SPDX matcher can look for
 * license phrases. The license notice usually lives in the file named after the
 * dependency itself, so such files are scanned first; then a cap of further
 * headers/sources is scanned to keep this cheap.
 */
export function readSourceHeaders(
  depName: string,
  installDir: string,
  readFile: ReadFile,
  readdir: ReadDir,
  subdirs: readonly string[] = ["src"],
): string | undefined {
  const dirs = [installDir, ...subdirs.map((s) => path.join(installDir, s))];
  // Normalize the dependency name into the stem its source files likely use:
  // "Adafruit seesaw Library" -> "adafruit_seesaw".
  const stem = depName.toLowerCase().replace(/\s+library$/, "").replace(/\s+/g, "_");
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
      // Files whose basename starts with the dependency stem go first — that is
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

// ---------------------------------------------------------------------------
// Dependency license resolver
// ---------------------------------------------------------------------------

export interface ResolveLicenseOptions {
  /** Subdirs searched for a LICENSE file / source headers beyond the root. */
  subdirs?: readonly string[];
  /**
   * Read a manifest file's text for a license field. Given the install dir and
   * the readFile seam, return the raw license value (or undefined). A
   * library.properties-style adapter wires this to read its `license=` field.
   * Omit to skip the manifest step (e.g. a framework whose manifest carries
   * no license field).
   */
  readManifestLicense?: (installDir: string, readFile: ReadFile) => string | undefined;
  /**
   * LicenseSource label attached when the license is found via
   * `readManifestLicense`. Defaults to `"manifest"`; a library.properties
   * adapter passes `"library.properties"` for parity with its existing output.
   */
  manifestSourceLabel?: LicenseSource;
}

/**
 * Resolve a single dependency's license. Priority: manifest → LICENSE file →
 * source-file header comments → none.
 *
 * Never throws: an unreadable manifest/LICENSE/source simply falls through to
 * the next step, ending at a `"none"` / unknown entry.
 */
export function resolveLibraryLicense(
  dep: DiscoveredDependency,
  readFile: ReadFile,
  readdir: ReadDir,
  options: ResolveLicenseOptions = {},
): LibraryLicenseEntry {
  const installDir = dep.installDir ?? "";
  const subdirs = options.subdirs ?? ["src"];
  const manifestLabel: LicenseSource = options.manifestSourceLabel ?? "manifest";

  const base = {
    name: dep.name,
    version: dep.version,
    path: installDir,
  };

  // 1. manifest (e.g. Arduino library.properties `license=`).
  if (options.readManifestLicense) {
    const manifestLicense = options.readManifestLicense(installDir, readFile);
    if (manifestLicense) {
      const spdx = identifySpdx(manifestLicense);
      if (spdx) {
        return { ...base, spdx, risk: classifyRisk(spdx), source: manifestLabel };
      }
    }
  }

  // 2. LICENSE file (root or a subdir).
  const fileText = readLicenseFile(installDir, readFile, readdir, subdirs);
  if (fileText) {
    const spdx = identifySpdx(fileText);
    if (spdx) {
      return { ...base, spdx, risk: classifyRisk(spdx), source: "license-file" };
    }
  }

  // 3. source-file header comments (Adafruit/Arduino pattern: license notice
  //    embedded at the top of the primary .h/.cpp, no standalone LICENSE file).
  const headerText = readSourceHeaders(dep.name, installDir, readFile, readdir, subdirs);
  if (headerText) {
    const spdx = identifySpdx(headerText);
    if (spdx) {
      return { ...base, spdx, risk: classifyRisk(spdx), source: "source-header" };
    }
  }

  // 4. unknown
  return { ...base, spdx: undefined, risk: "unknown", source: "none" };
}

// ---------------------------------------------------------------------------
// Presentation helpers (shared by every framework's presenter)
// ---------------------------------------------------------------------------

export function riskBracket(risk: CopyleftRisk): string {
  if (risk === "strong-copyleft") return "  [COPYLEFT]";
  if (risk === "weak-copyleft") return "  [weak copyleft]";
  return "";
}

export function statusMark(risk: CopyleftRisk): string {
  return risk === "permissive" ? "  ✓" : "";
}

export function countByRisk(libs: LibraryLicenseEntry[]): Record<CopyleftRisk, number> {
  const counts: Record<CopyleftRisk, number> = {
    permissive: 0,
    "weak-copyleft": 0,
    "strong-copyleft": 0,
    unknown: 0,
  };
  for (const l of libs) counts[l.risk] += 1;
  return counts;
}
