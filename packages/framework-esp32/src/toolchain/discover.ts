import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

/**
 * A discovered ESP-IDF install root — a directory containing export.sh /
 * export.bat and tools/idf.py.
 */
export interface IdfRoot {
  /** Absolute path to the IDF root (e.g. C:\esp\v6.0.2\esp-idf). */
  path: string;
  /** Version string (e.g. '6.0.2') if detectable; undefined otherwise. */
  version?: string;
  /** Which discovery strategy found this root. */
  source: 'env' | 'eim-manifest' | 'well-known' | 'version-scan' | 'path';
}

const IS_WIN = process.platform === 'win32';

/** True if `dir` looks like an IDF root: contains tools/idf.py AND an export
 *  script (export.sh on POSIX, export.bat on Windows). */
function isIdfRoot(dir: string): boolean {
  if (!dir) return false;
  if (!existsSync(join(dir, 'tools', 'idf.py'))) return false;
  // export.bat on Windows, export.sh elsewhere. Accept either to be lenient
  // (some installs ship both).
  if (IS_WIN) {
    return existsSync(join(dir, 'export.bat')) || existsSync(join(dir, 'export.sh'));
  }
  return existsSync(join(dir, 'export.sh')) || existsSync(join(dir, 'export.bat'));
}

/** Read the IDF version from <root>/tools/cmake/version.cmake if present.
 *  Returns undefined if the file is missing or unparseable. */
export function detectIdfVersion(root: string): string | undefined {
  const versionFile = join(root, 'tools', 'cmake', 'version.cmake');
  if (!existsSync(versionFile)) return undefined;
  try {
    const text = readFileSync(versionFile, 'utf8');
    const major = text.match(/IDF_VERSION_MAJOR\s+(\d+)/);
    const minor = text.match(/IDF_VERSION_MINOR\s+(\d+)/);
    const patch = text.match(/IDF_VERSION_PATCH\s+(\d+)/);
    if (major && minor && patch) {
      return `${major[1]}.${minor[1]}.${patch[1]}`;
    }
  } catch {
    // Fall through.
  }
  return undefined;
}

/** Compare two semver strings ('6.0.2' vs '5.5.1'). Returns >0 if a>b, <0 if a<b, 0 equal.
 *  Non-parseable versions sort lowest. */
export function compareSemver(a: string | undefined, b: string | undefined): number {
  const pa = (a ?? '0.0.0').split('.').map((n) => parseInt(n, 10) || 0);
  const pb = (b ?? '0.0.0').split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) {
    const da = pa[i] ?? 0, db = pb[i] ?? 0;
    if (da !== db) return da - db;
  }
  return 0;
}

// ── Strategy 1: $IDF_PATH env var ──────────────────────────────────────────

export function discoverFromEnv(): IdfRoot | null {
  const idfPath = process.env.IDF_PATH;
  if (!idfPath) return null;
  if (!isIdfRoot(idfPath)) return null;
  return { path: idfPath, version: detectIdfVersion(idfPath), source: 'env' };
}

// ── Strategy 2: EIM manifest (eim_idf.json) ─────────────────────────────────

/** Path to the EIM manifest on this platform. */
export function eimManifestPath(): string {
  if (IS_WIN) {
    // C:\Espressif\tools\eim_idf.json (documented Windows location).
    const sysDrive = process.env.SystemDrive ?? 'C:';
    return join(`${sysDrive}\\Espressif`, 'tools', 'eim_idf.json');
  }
  const home = process.env.HOME ?? process.env.USERPROFILE ?? '';
  return join(home, '.espressif', 'tools', 'eim_idf.json');
}

interface EimManifestEntry {
  // The manifest schema isn't strictly documented; we tolerate several shapes.
  path?: string;
  version?: string;
  name?: string;
  is_default?: boolean;
  default?: boolean;
}

/** Try to read + parse the EIM manifest. Returns the entry that points to a
 *  valid IDF root, preferring the default entry, else the highest version. */
export function discoverFromEimManifest(manifestPath: string = eimManifestPath()): IdfRoot | null {
  if (!existsSync(manifestPath)) return null;
  let parsed: any;
  try {
    parsed = JSON.parse(readFileSync(manifestPath, 'utf8'));
  } catch {
    return null;
  }
  // The manifest is an array of installed versions (tolerate {versions:[...]}
  // wrapper or bare array).
  const entries: EimManifestEntry[] = Array.isArray(parsed) ? parsed
    : Array.isArray(parsed?.versions) ? parsed.versions
    : Array.isArray(parsed?.idf) ? parsed.idf
    : [];
  if (entries.length === 0) return null;

  // Sort: default first, then highest version.
  const scored = entries
    .filter((e) => e.path)
    .map((e) => ({ entry: e, version: e.version ?? detectIdfVersion(e.path!) }))
    .sort((a, b) => {
      const aDef = a.entry.is_default || a.entry.default;
      const bDef = b.entry.is_default || b.entry.default;
      if (aDef && !bDef) return -1;
      if (bDef && !aDef) return 1;
      return compareSemver(b.version, a.version);
    });

  for (const { entry, version } of scored) {
    if (isIdfRoot(entry.path!)) {
      return { path: entry.path!, version, source: 'eim-manifest' };
    }
  }
  return null;
}

// ── Strategy 3: well-known default paths ────────────────────────────────────

/** Candidate well-known install paths for this platform. Used by discoverFromWellKnown;
 *  exported so tests can inspect/override. */
export function wellKnownPaths(): string[] {
  if (IS_WIN) {
    const sysDrive = process.env.SystemDrive ?? 'C:';
    return [
      join(`${sysDrive}\\esp`, 'esp-idf'),
      join(`${sysDrive}\\Espressif`, 'esp-idf'),
    ];
  }
  const home = process.env.HOME ?? process.env.USERPROFILE ?? '';
  return [
    join(home, 'esp', 'esp-idf'),
    join(home, '.espressif', 'esp-idf'),
    '/opt/esp/esp-idf',
  ];
}

export function discoverFromWellKnown(paths: string[] = wellKnownPaths()): IdfRoot | null {
  for (const p of paths) {
    if (isIdfRoot(p)) {
      return { path: p, version: detectIdfVersion(p), source: 'well-known' };
    }
  }
  return null;
}

// ── Strategy 4: version-tagged parent scan ──────────────────────────────────

/** Parent directories to scan for `<parent>/<version>/esp-idf/` layouts.
 *  EIM uses C:\esp\v6.0.2\esp-idf and ~/.espressif/v6.0.2/esp-idf. */
export function versionScanParents(): string[] {
  if (IS_WIN) {
    const sysDrive = process.env.SystemDrive ?? 'C:';
    return [`${sysDrive}\\esp`, `${sysDrive}\\Espressif`];
  }
  const home = process.env.HOME ?? process.env.USERPROFILE ?? '';
  return [join(home, 'esp'), join(home, '.espressif')];
}

/** Scan parent dirs for `<parent>/<subdir>/esp-idf` and return the highest-version
 *  match. `parents` is injectable for testing. */
export function discoverFromVersionScan(parents: string[] = versionScanParents()): IdfRoot | null {
  const found: IdfRoot[] = [];
  for (const parent of parents) {
    let entries: string[] = [];
    try {
      entries = readdirSync(parent);
    } catch {
      continue;  // parent doesn't exist or isn't readable
    }
    for (const sub of entries) {
      const candidate = join(parent, sub, 'esp-idf');
      if (isIdfRoot(candidate)) {
        const version = detectIdfVersion(candidate) ?? parseVersionFromSegment(sub);
        found.push({ path: candidate, version, source: 'version-scan' });
      }
    }
  }
  if (found.length === 0) return null;
  // Pick highest version; ties broken by path for determinism.
  found.sort((a, b) => compareSemver(b.version, a.version) || a.path.localeCompare(b.path));
  return found[0];
}

/** Try to extract a version from a directory segment like 'v6.0.2' or '6.0.2'. */
function parseVersionFromSegment(seg: string): string | undefined {
  const m = seg.match(/v?(\d+\.\d+\.\d+)/);
  return m ? m[1] : undefined;
}

// ── Strategy 5: idf.py on $PATH ─────────────────────────────────────────────

export function discoverFromPath(): IdfRoot | null {
  const which = spawnSync(IS_WIN ? 'where' : 'which', ['idf.py'], {
    encoding: 'utf8',
    shell: true,
  });
  if (which.status !== 0) return null;
  const lines = (which.stdout ?? '').split(/\r?\n/).filter(Boolean);
  for (const line of lines) {
    // idf.py lives at <root>/tools/idf.py — walk up two parents.
    try {
      const resolved = statSync(line).isDirectory() ? line : line;
      // `where`/`which` returns the script path; resolve symlinks.
      const toolsDir = join(resolved, '..');      // .../tools
      const root = join(toolsDir, '..');           // .../<root>
      if (isIdfRoot(root)) {
        return { path: root, version: detectIdfVersion(root), source: 'path' };
      }
    } catch {
      // Stat failed (race / weird PATH entry); try next line.
    }
  }
  return null;
}

// ── Top-level cascade ────────────────────────────────────────────────────────

/**
 * Try each discovery strategy in order; return the first IdfRoot found, or null.
 * Order: $IDF_PATH → EIM manifest → well-known defaults → version-dir scan → PATH.
 */
export function discoverIdfRoot(): IdfRoot | null {
  return discoverFromEnv()
    ?? discoverFromEimManifest()
    ?? discoverFromWellKnown()
    ?? discoverFromVersionScan()
    ?? discoverFromPath();
}
