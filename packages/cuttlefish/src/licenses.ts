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
