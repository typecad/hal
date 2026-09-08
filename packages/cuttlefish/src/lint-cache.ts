/**
 * Persistent cache for the ESLint build gate.
 *
 * ESLint is a mandatory correctness gate: it excludes non-AOT code patterns
 * that the transpiler cannot accept. Running it on every `typecad-hal build`
 * costs ~3s (38% of a small-project build) and almost always finds nothing on
 * repeat runs. Its result (zero errors) is a whole-program boolean that
 * depends only on a small set of inputs, so it is cleanly cacheable.
 *
 * Soundness contract:
 *   - The cache ONLY records a successful (zero-error) lint result.
 *   - A failing lint never persists (the build aborts anyway).
 *   - On ANY input change the entry is invalidated and ESLint runs for real.
 *   - `options.force` and the `TYPECAD_HAL_NO_CACHE` env var bypass entirely.
 *
 * This mirrors the historical `.typecad-hal-cache.json` timestamp+hash cache
 * that used to live in this package. It is scoped to the ESLint gate (and the
 * type-check gate) rather than the transpile-IR pass, because — unlike IR
 * lowering — these gates' outcomes are whole-program booleans with no
 * cross-module rehydration requirement.
 */

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const CACHE_VERSION = 2;
const DEFAULT_CACHE_NAME = ".typecad-hal-cache.json";

/** Bypass the cache entirely when set (debugging / CI cold runs). */
function isCacheDisabled(): boolean {
  return process.env.TYPECAD_HAL_NO_CACHE === "1" || process.env.TYPECAD_HAL_NO_CACHE === "true";
}

/**
 * Hash a file's content. Returns null if the file cannot be read (treated as
 * "changed" by callers because the input set is no longer what we recorded).
 */
function hashFile(absPath: string): string | null {
  try {
    const content = fs.readFileSync(absPath, "utf8");
    return crypto.createHash("sha256").update(content).digest("hex").slice(0, 16);
  } catch {
    return null;
  }
}

/**
 * Hash size + mtime for a file. Used for inputs (eslint config, eslint package)
 * that we don't want to fully read on every build, and whose identity is
 * sufficiently captured by size+mtime. Returns null if the file is missing.
 */
function fingerprintStat(absPath: string): string | null {
  try {
    const stat = fs.statSync(absPath);
    return `${stat.size}:${stat.mtimeMs}`;
  } catch {
    return null;
  }
}

/**
 * Transpiler-self fingerprint: invalidate every cache entry when the
 * transpiler's own compiled sources change. Mirrors the historical
 * computeToolchainFingerprint() in incremental-cache.ts.
 */
let cachedToolchainFingerprint: string | undefined;
function computeToolchainFingerprint(): string {
  if (cachedToolchainFingerprint !== undefined) return cachedToolchainFingerprint;
  const candidates = [
    "transpile.js",
    "lint-cache.js",
    "eslint-check.js",
    path.join("emit", "cpp-emitter.js"),
    path.join("ir", "build-ir.js"),
    path.join("ir", "ownership-analysis.js"),
    path.join("ir", "validation-orchestrator.js"),
  ];
  const signature = candidates
    .map((rel) => path.join(__dirname, rel))
    .filter((p) => fs.existsSync(p))
    .map((p) => {
      const stat = fs.statSync(p);
      return `${path.basename(p)}:${stat.size}:${stat.mtimeMs}`;
    })
    .join("|");
  cachedToolchainFingerprint = crypto.createHash("sha256").update(signature).digest("hex").slice(0, 16);
  return cachedToolchainFingerprint;
}

/** Resolve the eslint config the same way runEslintCheck does, to avoid drift. */
export function resolveEslintConfigPath(projectRoot: string): string | undefined {
  const cuttlefishConfig = path.join(projectRoot, ".typecad-hal", "eslint.config.mjs");
  if (fs.existsSync(cuttlefishConfig)) return cuttlefishConfig;
  for (const name of ["eslint.config.mjs", "eslint.config.js", "eslint.config.cjs"]) {
    const candidate = path.join(projectRoot, name);
    if (fs.existsSync(candidate)) return candidate;
  }
  return undefined;
}

/** Resolve the eslint package version that runEslintCheck would load. */
function resolveEslintIdentity(projectRoot: string): { path: string; version: string } | null {
  const resolvers = [
    createRequire(path.join(projectRoot, "package.json")),
    require,
  ];
  for (const r of resolvers) {
    try {
      const eslintPath = r.resolve("eslint");
      const pkgPath = r.resolve("eslint/package.json");
      const version = (JSON.parse(fs.readFileSync(pkgPath, "utf8")) as { version?: string }).version ?? "unknown";
      return { path: eslintPath, version };
    } catch {
      // try next resolver
    }
  }
  return null;
}

/** Recursively gather .ts/.tsx/.ui files under a directory (the lint input set). */
function gatherSourceFiles(srcDir: string): string[] {
  const out: string[] = [];
  if (!fs.existsSync(srcDir) || !fs.statSync(srcDir).isDirectory()) return out;
  const stack = [srcDir];
  while (stack.length > 0) {
    const dir = stack.pop()!;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "node_modules" || entry.name === "out" || entry.name.startsWith("out-")) continue;
        stack.push(full);
      } else if (entry.isFile()) {
        const ext = entry.name.toLowerCase();
        if (ext.endsWith(".ts") || ext.endsWith(".tsx") || ext.endsWith(".ui")) {
          out.push(full);
        }
      }
    }
  }
  out.sort();
  return out;
}

/**
 * Compute the inputs that the ESLint result depends on. Two builds with the
 * same fingerprint are guaranteed to produce the same lint outcome.
 */
export interface LintFingerprint {
  digest: string;
  /** Absolute paths that were hashed into the digest (for debugging). */
  inputs: string[];
}

export function computeLintFingerprint(projectRoot: string, srcDir: string): LintFingerprint | null {
  const configPath = resolveEslintConfigPath(projectRoot);
  if (!configPath) return null; // no config => runEslintCheck returns [] without loading eslint
  const eslint = resolveEslintIdentity(projectRoot);
  if (!eslint) return null; // eslint unresolvable => runEslintCheck returns []

  const parts: string[][] = [];
  parts.push(["toolchain", computeToolchainFingerprint()]);
  parts.push(["eslint", `${eslint.version}@${eslint.path}`]);
  parts.push(["config", `${configPath}:${fingerprintStat(configPath) ?? "missing"}`]);

  const sources = gatherSourceFiles(srcDir);
  for (const f of sources) {
    const h = hashFile(f);
    parts.push(["src", `${f}:${h ?? "missing"}`]);
  }

  const digest = crypto
    .createHash("sha256")
    .update(parts.map((p) => p.join("=")).join("\n"))
    .digest("hex")
    .slice(0, 32);
  return { digest, inputs: parts.map((p) => p[1]) };
}

// ────────────────────────────────────────────────────────────────────────────
// On-disk cache. One file per project root, shared across gate kinds
// (lint now, type-check later) so a single invalidation covers both.
// ────────────────────────────────────────────────────────────────────────────

interface GateCacheFile {
  version: number;
  toolchainFingerprint: string;
  rootDir: string;
  gates: {
    lint?: { digest: string; recordedAt: number };
    typecheck?: { digest: string; recordedAt: number };
  };
  createdAt: number;
  updatedAt: number;
}

function cachePathFor(projectRoot: string): string {
  return path.join(projectRoot, DEFAULT_CACHE_NAME);
}

function loadCacheFile(projectRoot: string): GateCacheFile | null {
  const cachePath = cachePathFor(projectRoot);
  try {
    if (!fs.existsSync(cachePath)) return null;
    const data = JSON.parse(fs.readFileSync(cachePath, "utf8")) as GateCacheFile;
    if (
      data.version === CACHE_VERSION &&
      data.toolchainFingerprint === computeToolchainFingerprint() &&
      path.resolve(data.rootDir) === path.resolve(projectRoot)
    ) {
      return data;
    }
  } catch {
    // Corrupt or unreadable — treat as empty.
  }
  return null;
}

function saveCacheFile(projectRoot: string, data: GateCacheFile): void {
  data.updatedAt = Date.now();
  try {
    fs.writeFileSync(cachePathFor(projectRoot), JSON.stringify(data, null, 2), "utf8");
  } catch {
    // Non-fatal: caching is best-effort. Next build just re-runs the gate.
  }
}

function freshCacheFile(projectRoot: string): GateCacheFile {
  return {
    version: CACHE_VERSION,
    toolchainFingerprint: computeToolchainFingerprint(),
    rootDir: path.resolve(projectRoot),
    gates: {},
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

// ────────────────────────────────────────────────────────────────────────────
// Public API
// ────────────────────────────────────────────────────────────────────────────

export interface GateCacheResult {
  /** True when the gate can be skipped because the recorded success still holds. */
  hit: boolean;
  /** The fingerprint to record after a successful gate run. */
  fingerprint: LintFingerprint | null;
}

/**
 * Decide whether the ESLint gate can be skipped for this project.
 *
 * Returns `hit: true` only when:
 *   - caching is not disabled, not force-bypassed,
 *   - a fingerprint can be computed (config + eslint resolvable), and
 *   - the on-disk cache records a success for that exact fingerprint.
 *
 * `force` mirrors TranspileOptions.force and bypasses the cache.
 */
export function checkLintCache(
  projectRoot: string,
  srcDir: string,
  opts: { force?: boolean } = {},
): GateCacheResult {
  const fingerprint = computeLintFingerprint(projectRoot, srcDir);
  if (fingerprint === null) return { hit: false, fingerprint: null };
  if (opts.force || isCacheDisabled()) return { hit: false, fingerprint };
  const data = loadCacheFile(projectRoot);
  if (!data) return { hit: false, fingerprint };
  const entry = data.gates.lint;
  return { hit: entry?.digest === fingerprint.digest, fingerprint };
}

/**
 * Record a successful ESLint run (zero errors). Never call this after a
 * failing run — a failing build must not persist a "clean" marker.
 */
export function recordLintSuccess(projectRoot: string, fingerprint: LintFingerprint): void {
  if (isCacheDisabled()) return;
  const data = loadCacheFile(projectRoot) ?? freshCacheFile(projectRoot);
  data.gates.lint = { digest: fingerprint.digest, recordedAt: Date.now() };
  saveCacheFile(projectRoot, data);
}

/** Drop the lint entry (used when the gate is skipped entirely / nothing to cache). */
export function invalidateLint(projectRoot: string): void {
  const data = loadCacheFile(projectRoot);
  if (data && data.gates.lint) {
    delete data.gates.lint;
    saveCacheFile(projectRoot, data);
  }
}
