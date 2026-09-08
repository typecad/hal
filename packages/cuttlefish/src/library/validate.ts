// ---------------------------------------------------------------------------
// `typecad-hal library validate` — the standalone library-package validator.
//
// Before this, manifest errors only surfaced at import time inside a
// transpile. This runs the same checks (and more) on a package directory:
// manifest schema, file existence, include/gateToken consistency, npm
// keyword consistency, and an AUTOSAR --strict pass over the shim bytes —
// the same self-check the generated application runs over them.
// ---------------------------------------------------------------------------

import fs from "node:fs";
import path from "node:path";
import { ComplianceContext, runSelfCheck, type SelfCheckFinding } from "../emit/compliance/index.js";
import { LIBRARY_MARKER_KEYWORD, CATEGORY_KEYWORD_PREFIX, libraryCategory } from "./catalog.js";

export interface LibraryValidationFinding {
  severity: "error" | "warning";
  message: string;
}

export interface LibraryValidationReport {
  valid: boolean;
  /** The package directory that was validated. */
  dir: string;
  errors: string[];
  warnings: string[];
  /** Unrecorded AUTOSAR violations in the shim sources (strict mode). */
  autosarFindings: SelfCheckFinding[];
}

interface MinimalManifest {
  id?: unknown;
  module?: unknown;
  framework?: unknown;
  targets?: unknown;
  include?: unknown;
  gateToken?: unknown;
  shims?: unknown;
  kconfig?: unknown;
  overlay?: unknown;
}

function readJson(filePath: string): unknown {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

export function validateLibraryPackage(dir: string): LibraryValidationReport {
  const errors: string[] = [];
  const warnings: string[] = [];
  const root = path.resolve(dir);

  const fail = (message: string): void => {
    errors.push(message);
  };

  // ── Manifest ───────────────────────────────────────────────────────────
  const manifestPath = path.join(root, "typecad-hal.library.json");
  let manifest: MinimalManifest | undefined;
  if (!fs.existsSync(manifestPath)) {
    fail("typecad-hal.library.json not found — is this a library package directory?");
  } else {
    try {
      manifest = readJson(manifestPath) as MinimalManifest;
    } catch (e) {
      fail(`typecad-hal.library.json is not valid JSON: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  if (manifest) {
    for (const field of ["id", "module", "framework", "include", "gateToken"] as const) {
      if (typeof manifest[field] !== "string" || (manifest[field] as string).length === 0) {
        fail(`Manifest field '${field}' must be a non-empty string.`);
      }
    }
    if (!Array.isArray(manifest.shims) || manifest.shims.length === 0) {
      fail("Manifest 'shims' must be a non-empty array.");
    }

    const include = typeof manifest.include === "string" ? manifest.include : "";
    const gateToken = typeof manifest.gateToken === "string" ? manifest.gateToken : "";
    if (include.length > 0 && gateToken.length > 0 && !include.includes(gateToken)) {
      fail(
        `The gate token '${gateToken}' does not appear in the include '${include}' — ` +
          `the include line is the only guaranteed emission, so contributions would never gate on.`,
      );
    }

    // ── Shim files ───────────────────────────────────────────────────────
    if (Array.isArray(manifest.shims)) {
      for (const entry of manifest.shims) {
        if (
          typeof entry !== "object" ||
          entry === null ||
          typeof (entry as { path?: unknown }).path !== "string" ||
          typeof (entry as { outName?: unknown }).outName !== "string"
        ) {
          fail("Every 'shims' entry needs string 'path' and 'outName' fields.");
          continue;
        }
        const shimPath = path.join(root, (entry as { path: string }).path);
        if (!fs.existsSync(shimPath)) {
          fail(`Shim file listed in the manifest is missing: ${(entry as { path: string }).path}`);
        }
      }
    }

    // ── Overlay fragment ─────────────────────────────────────────────────
    if (typeof manifest.overlay === "string" && manifest.overlay.length > 0) {
      const overlayPath = path.join(root, manifest.overlay);
      if (!fs.existsSync(overlayPath)) {
        fail(`Overlay fragment listed in the manifest is missing: ${manifest.overlay}`);
      }
    }
  }

  // ── package.json consistency ───────────────────────────────────────────
  const pkgJsonPath = path.join(root, "package.json");
  let pkgName: string | undefined;
  let pkgKeywords: string[] = [];
  if (!fs.existsSync(pkgJsonPath)) {
    warnings.push("No package.json — nothing published, so keyword checks are skipped.");
  } else {
    try {
      const pkg = readJson(pkgJsonPath) as { name?: unknown; keywords?: unknown; files?: unknown };
      if (typeof pkg.name === "string") {
        pkgName = pkg.name;
      }
      if (Array.isArray(pkg.keywords)) {
        pkgKeywords = pkg.keywords.filter((k): k is string => typeof k === "string");
      }
      if (Array.isArray(pkg.files) && !pkg.files.includes("typecad-hal.library.json")) {
        fail("package.json 'files' must include 'typecad-hal.library.json' or the manifest will not ship.");
      }
    } catch (e) {
      fail(`package.json is not valid JSON: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  if (pkgKeywords.length > 0 && !pkgKeywords.map((k) => k.toLowerCase()).includes(LIBRARY_MARKER_KEYWORD)) {
    fail(`package.json keywords must include the marker '${LIBRARY_MARKER_KEYWORD}' — it is what library search scans for.`);
  }
  const categoryKeywords = pkgKeywords.filter((k) => k.startsWith(CATEGORY_KEYWORD_PREFIX) && k !== LIBRARY_MARKER_KEYWORD);
  if (pkgKeywords.length > 0 && categoryKeywords.length === 0) {
    warnings.push(
      `No category keyword in package.json — add one of ${LIBRARY_MARKER_KEYWORD}'s siblings (e.g. typecad-hal-led) so the library is browsable by category.`,
    );
  }
  for (const kw of categoryKeywords) {
    const id = kw.slice(CATEGORY_KEYWORD_PREFIX.length);
    if (!libraryCategory(id)) {
      warnings.push(`Keyword '${kw}' is not a known category keyword (typecad-hal-<id>).`);
    }
  }
  if (categoryKeywords.length > 1) {
    warnings.push(
      `Multiple category keywords (${categoryKeywords.join(", ")}) — search results show the first taxonomy match only.`,
    );
  }

  if (manifest && pkgName !== undefined && typeof manifest.module === "string" && manifest.module !== pkgName) {
    fail(
      `Manifest 'module' (${manifest.module}) must equal the package.json name (${pkgName}) — ` +
        `the import specifier users write resolves against the package name.`,
    );
  }

  // ── AUTOSAR strict over the shim bytes ─────────────────────────────────
  const autosarFindings: SelfCheckFinding[] = [];
  if (manifest && Array.isArray(manifest.shims)) {
    const headerLines: string[] = [];
    const sourceLines: string[] = [];
    let anyReadable = false;
    for (const entry of manifest.shims) {
      if (typeof entry !== "object" || entry === null) continue;
      const rel = (entry as { path?: unknown }).path;
      if (typeof rel !== "string") continue;
      const abs = path.join(root, rel);
      if (!fs.existsSync(abs)) continue;
      anyReadable = true;
      const content = fs.readFileSync(abs, "utf8").split("\n");
      if (abs.endsWith(".h") || abs.endsWith(".hpp")) {
        headerLines.push(...content, "");
      } else {
        sourceLines.push(...content, "");
      }
    }
    if (anyReadable) {
      const ctx = new ComplianceContext("strict");
      autosarFindings.push(...runSelfCheck(ctx, sourceLines, headerLines));
    }
  }
  for (const finding of autosarFindings) {
    fail(
      `AUTOSAR ${finding.ruleId} (${finding.file} line ${finding.line}): ${finding.snippet}`,
    );
  }

  return {
    valid: errors.length === 0,
    dir: root,
    errors,
    warnings,
    autosarFindings,
  };
}

/** Render the human-readable report. Returns the process exit code (0/1). */
export function printValidationReport(report: LibraryValidationReport): number {
  for (const warning of report.warnings) {
    console.log(`  ! ${warning}`);
  }
  for (const error of report.errors) {
    console.log(`  x ${error}`);
  }
  if (report.valid) {
    console.log(`  Valid library package${report.warnings.length > 0 ? ` (${report.warnings.length} warning${report.warnings.length === 1 ? "" : "s"})` : ""}.`);
    return 0;
  }
  console.log(`  ${report.errors.length} error${report.errors.length === 1 ? "" : "s"}.`);
  return 1;
}
