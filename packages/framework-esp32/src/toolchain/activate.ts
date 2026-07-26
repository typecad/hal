import { existsSync, readFileSync, readdirSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import type { SpawnSyncOptions } from 'node:child_process';
import { type IdfRoot, discoverIdfRoot } from './discover.js';
import { detectIdfEnv } from './idf-env.js';
import { scrubMsysEnv } from '../lowering/util.js';

const IS_WIN = process.platform === 'win32';

export const WRAPPER_NAME = IS_WIN ? 'cuttlefish-idf-env.bat' : 'cuttlefish-idf-env.sh';

// ── Env cache ─────────────────────────────────────────────────────────────
// Sourcing export.bat/export.sh takes ~5-15s per invocation (Python venv
// activation, PATH manipulation). The resulting env vars don't change between
// runs for the same IDF install. We cache them to a JSON file keyed by the
// IDF root path, so subsequent builds skip the sourcing entirely and just
// pass the cached env directly to idf.py.

const ENV_CACHE_DIR = IS_WIN
  ? join(process.env.LOCALAPPDATA ?? process.env.HOME ?? '/tmp', 'TypeCAD')
  : join(process.env.HOME ?? '/tmp', '.cache', 'typecad');

function envCachePath(root: IdfRoot): string {
  // Hash the root path into a safe filename.
  const safeName = root.path.replace(/[^a-zA-Z0-9]/g, '_').slice(-80);
  return join(ENV_CACHE_DIR, `idf-env-${safeName}-${root.version ?? 'unknown'}.json`);
}

/** Capture the full environment after sourcing export.{sh,bat}.
 *  Returns a Record<string, string> of all env vars. */
function captureSourcedEnv(root: IdfRoot): Record<string, string> | null {
  const exportScript = IS_WIN
    ? join(root.path, 'export.bat')
    : join(root.path, 'export.sh');

  if (!existsSync(exportScript)) return null;

  // Strip MSYS vars (Windows) so export.bat doesn't bail.
  const cleanEnv = scrubMsysEnv({ ...process.env }) as NodeJS.ProcessEnv;

  if (IS_WIN) {
    // cmd.exe's arg handling with quoted paths is broken in Node's spawn.
    // Write a temp .bat that sources export.bat and dumps env to a temp file.
    const tmpBat = join(tmpdir(), `tc-env-capture-${Date.now()}.bat`);
    const tmpOut = join(tmpdir(), `tc-env-dump-${Date.now()}.txt`);
    writeFileSync(tmpBat, [
      '@echo off',
      `call "${exportScript}"`,
      `set > "${tmpOut}"`,
      '',
    ].join('\r\n'));

    try {
      const result = spawnSync('cmd.exe', ['/c', tmpBat], {
        encoding: 'utf8',
        timeout: 60000,
        env: cleanEnv,
      });

      if (!existsSync(tmpOut)) return null;

      const output = readFileSync(tmpOut, 'utf8');
      const env: Record<string, string> = {};
      for (const line of output.split(/\r?\n/)) {
        const eq = line.indexOf('=');
        if (eq > 0) {
          env[line.slice(0, eq)] = line.slice(eq + 1);
        }
      }

      if (!env.IDF_PATH) return null;
      return env;
    } finally {
      try { rmSync(tmpBat, { force: true }); } catch {}
      try { rmSync(tmpOut, { force: true }); } catch {}
    }
  }

  // POSIX: bash -c 'source export.sh && env -0'
  const result = spawnSync('bash', ['-c', `source "${exportScript}" > /dev/null 2>&1 && env -0`], {
    encoding: 'utf8',
    timeout: 60000,
    env: cleanEnv,
  });

  if (result.status !== 0) return null;

  const env: Record<string, string> = {};
  for (const entry of (result.stdout ?? '').split('\0')) {
    const eq = entry.indexOf('=');
    if (eq > 0) {
      env[entry.slice(0, eq)] = entry.slice(eq + 1);
    }
  }

  if (!env.IDF_PATH) return null;
  return env;
}

/** Load cached env for an IDF root, or capture + cache it. */
function loadOrCaptureEnv(root: IdfRoot): Record<string, string> | null {
  const cachePath = envCachePath(root);

  // Try cache first.
  if (existsSync(cachePath)) {
    try {
      const cached = JSON.parse(readFileSync(cachePath, 'utf8'));
      // Validate cache: IDF_PATH must exist and point at the right root.
      if (cached.IDF_PATH && existsSync(join(cached.IDF_PATH, 'tools', 'idf.py'))) {
        return cached;
      }
    } catch {
      // Corrupted cache — fall through to recapture.
    }
  }

  // Capture fresh.
  const env = captureSourcedEnv(root);
  if (!env) return null;

  // Write cache.
  try {
    mkdirSync(ENV_CACHE_DIR, { recursive: true });
    writeFileSync(cachePath, JSON.stringify(env));
  } catch {
    // Cache write failed — non-fatal; we'll recapture next time.
  }

  return env;
}

/**
 * Resolved absolute paths for the ESP toolchain binaries that cortex-debug
 * needs to launch GDB + OpenOCD directly. Unlike gdbtarget (which can resolve
 * these via the ESP-IDF extension's ${command:espIdf.getToolchainGdb}),
 * cortex-debug has no ESP-IDF awareness and must be told the exact paths.
 */
export interface EspToolchainPaths {
  /** Absolute path to the xtensa GDB executable (e.g. xtensa-esp-elf-gdb.exe). */
  gdbPath: string;
  /** Absolute path to the OpenOCD executable (e.g. openocd.exe / openocd). */
  openocdPath: string;
}

/**
 * Resolve the ESP toolchain GDB + OpenOCD executable paths for the discovered
 * IDF install. Reads the activated env cache (which IDF's export.{sh,bat}
 * populated with the toolchain bin dirs on PATH), picks the xtensa GDB and
 * openocd entries, and returns their absolute executable paths.
 *
 * Returns null when no IDF root is discoverable or the env cache can't be
 * loaded — callers fall back to leaving gdbPath/serverpath unset (the user
 * can set cortex-debug.gdbPath / .openocdPath in settings.json manually).
 *
 * Exported for use by debug-config generation.
 */
export function resolveEspToolchains(): EspToolchainPaths | null {
  const root = discoverIdfRoot();
  if (!root) return null;
  const env = loadOrCaptureEnv(root);
  if (!env || !env.PATH) return null;

  // Split PATH on the platform separator ONLY. Splitting on both ';' and ':'
  // would corrupt Windows drive-prefixed entries like 'C:\Users\...'.
  const sep = IS_WIN ? ';' : ':';
  const pathEntries = env.PATH.split(sep).map((p) => p.replace(/\\/g, '/')).filter(Boolean);

  // IDF v6 ships the unified `xtensa-esp-elf-gdb`; older IDF used per-target
  // `xtensa-esp32s3-elf-gdb`. Match the prefix so both layouts resolve.
  const gdbBinDir = pathEntries.find((p) => /xtensa-esp[a-z0-9-]*-elf-gdb\/bin$/i.test(p));
  const openocdBinDir = pathEntries.find((p) => /openocd-esp[a-z0-9]*\/bin$/i.test(p));
  if (!gdbBinDir || !openocdBinDir) return null;

  const exe = IS_WIN ? '.exe' : '';

  // The GDB executable name mirrors the toolchain dir's parent (e.g.
  // 'xtensa-esp-elf-gdb'). IDF v6 also ships version-suffixed variants
  // (xtensa-esp-elf-gdb-3.14.exe) — prefer the bare-named binary if present,
  // otherwise pick the highest version-suffixed one deterministically.
  const gdbBaseName = gdbBinDir.split('/').filter(Boolean).slice(-2, -1)[0] ?? 'xtensa-esp-elf-gdb';
  const gdbPath = resolveVersionedBinary(gdbBinDir, gdbBaseName, exe);

  // OpenOCD's binary is plain 'openocd' even though IDF's fork ships under an
  // 'openocd-esp32' dir. Use resolveVersionedBinary so it prefers the bare
  // name and falls back to version-suffixed siblings if present.
  const openocdPath = resolveVersionedBinary(openocdBinDir, 'openocd', exe);
  return {
    gdbPath: gdbPath ?? `${gdbBinDir}/${gdbBaseName}${exe}`,
    openocdPath: openocdPath ?? `${openocdBinDir}/openocd${exe}`,
  };
}

/**
 * Given a toolchain bin dir and a base binary name, return the path to the
 * bare-named executable if it exists; otherwise pick the highest
 * version-suffixed sibling (e.g. `xtensa-esp-elf-gdb-3.14.exe` from
 * `xtensa-esp-elf-gdb`). Returns null if no candidate is found.
 *
 * Version comparison is component-wise (3.14 > 3.9), NOT float — parseFloat
 * would rank 3.9 > 3.14 and 3.10 < 3.9, both wrong.
 */
export function resolveVersionedBinary(binDir: string, baseName: string, exe: string): string | null {
  try {
    const entries = readdirSync(binDir.replace(/\//g, IS_WIN ? '\\' : '/'));
    // Prefer the exact bare name.
    const bare = `${baseName}${exe}`;
    if (entries.includes(bare)) return `${binDir}/${bare}`;
    // Otherwise find version-suffixed siblings and pick the highest version.
    const versions = entries
      .filter((e) => e.startsWith(`${baseName}-`) && e.endsWith(exe))
      .map((e) => e.slice(baseName.length + 1, e.length - exe.length));
    if (versions.length === 0) return null;
    versions.sort(compareVersions);
    return `${binDir}/${baseName}-${versions[versions.length - 1]}${exe}`;
  } catch {
    return null;
  }
}

/** Component-wise dotted-version comparison. 3.14 > 3.9, 3.10 > 3.9, 3.9.1 > 3.9. */
function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map((n) => parseInt(n, 10) || 0);
  const pb = b.split('.').map((n) => parseInt(n, 10) || 0);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const da = pa[i] ?? 0;
    const db = pb[i] ?? 0;
    if (da !== db) return da - db;
  }
  return 0;
}

/** Marker comment embedded in the wrapper so we can detect when the wrapper
 *  already targets the desired root (idempotence check). Platform-specific
 *  comment prefix — REM in .bat, # in .sh. */
const ROOT_MARKER_PREFIX_POSIX = '# cuttlefish-idf-root:';
const ROOT_MARKER_PREFIX_WIN = 'REM cuttlefish-idf-root:';

export interface ActivationResult {
  /** True if a wrapper was generated or already present for this root.
   *  False if the env was already sourced and no wrapper is needed. */
  activated: boolean;
  /** The IDF root the wrapper sources. */
  root: IdfRoot;
  /** Absolute path to the wrapper file (only meaningful when activated=true). */
  wrapperPath: string;
  /** Human-readable status line for surfacing to the user. */
  message: string;
}

/** Return the absolute path to the wrapper for a given project dir. */
export function wrapperPathFor(projectDir: string): string {
  return join(projectDir, WRAPPER_NAME);
}

/** Build the wrapper script contents that source <root> and forward to idf.py. */
export function buildWrapperContent(root: IdfRoot): string {
  const rootPath = root.path;
  if (IS_WIN) {
    return [
      '@echo off',
      'REM Auto-generated by @typecad/framework-esp32.',
      'REM Activates the ESP-IDF environment, then runs idf.py with all forwarded args.',
      'REM Inspect or edit freely; deleted automatically when the project is regenerated.',
      `${ROOT_MARKER_PREFIX_WIN} ${rootPath}`,
      `call "${rootPath}\\export.bat"`,
      'idf.py %*',
      '',
    ].join('\r\n');
  }
  return [
    '#!/usr/bin/env bash',
    '# Auto-generated by @typecad/framework-esp32.',
    '# Sources the ESP-IDF environment, then runs idf.py with all forwarded args.',
    '# Inspect or edit freely; deleted automatically when the project is regenerated.',
    `${ROOT_MARKER_PREFIX_POSIX} ${rootPath}`,
    `source "${rootPath}/export.sh"`,
    'exec idf.py "$@"',
    '',
  ].join('\n');
}

/** The marker line for a given root, in the current platform's comment syntax. */
function markerLineFor(root: IdfRoot): string {
  const prefix = IS_WIN ? ROOT_MARKER_PREFIX_WIN : ROOT_MARKER_PREFIX_POSIX;
  return `${prefix} ${root.path}`;
}

/** Write the wrapper if missing or stale (root changed). Returns the wrapper path. */
function ensureWrapper(projectDir: string, root: IdfRoot): { wrapperPath: string; wrote: boolean } {
  const wrapperPath = wrapperPathFor(projectDir);
  const desiredContent = buildWrapperContent(root);
  const markerLine = markerLineFor(root);
  if (existsSync(wrapperPath)) {
    try {
      const existing = readFileSync(wrapperPath, 'utf8');
      // Idempotence: if the existing wrapper already references this exact root,
      // don't rewrite (avoids mtime churn on every build).
      if (existing.includes(markerLine)) {
        return { wrapperPath, wrote: false };
      }
    } catch {
      // Fall through and rewrite.
    }
  }
  writeFileSync(wrapperPath, desiredContent);
  return { wrapperPath, wrote: true };
}

/**
 * Ensure the ESP-IDF environment is activated for the given project.
 *
 * - If the env is already sourced in the current shell (detectIdfEnv().available),
 *   returns { activated: false } — no wrapper needed, idf.py can be called directly.
 * - Otherwise discovers the IDF root and generates a wrapper script that sources
 *   export.{sh,bat} and runs idf.py. Subsequent idf.py invocations should go
 *   through this wrapper (see idfSpawn).
 *
 * Throws if the env is not sourced AND discovery fails to find an IDF root.
 */
export function ensureIdfActivated(projectDir: string): ActivationResult {
  const env = detectIdfEnv();
  if (env.available) {
    // Already sourced — no activation needed. We don't have a discovered-root
    // object in this branch (the env's idfPath is the root), but we can
    // synthesize one for the return shape.
    return {
      activated: false,
      root: { path: env.idfPath!, version: undefined, source: 'env' },
      wrapperPath: '',
      message: 'ESP-IDF environment already active in current shell.',
    };
  }

  const root = discoverIdfRoot();
  if (!root) {
    throw new Error(env.message);
  }

  const { wrapperPath } = ensureWrapper(projectDir, root);
  return {
    activated: true,
    root,
    wrapperPath,
    message: `[framework-esp32] Auto-sourced ESP-IDF ${root.version ?? ''} from ${root.path} via ${WRAPPER_NAME} (discovered via ${root.source})`,
  };
}

// ── Per-spawn invocation helper ──────────────────────────────────────────────

export interface IdfInvocation {
  /** The command to spawnSync: 'idf.py' (env already sourced) or the shell
   *  that runs the wrapper ('cmd.exe' on Windows, 'bash' on POSIX). */
  command: string;
  /** Args for the command. */
  args: string[];
  /** The base spawn options (cwd/timeout/encoding/stdio), passed through. */
  options: SpawnSyncOptions;
  /** The activation result, if activation happened. Callers may surface
   *  result.message to the user. */
  activation?: ActivationResult;
}

/**
 * Build a spawn invocation that runs `idf.py <idfArgs>` — either directly
 * (if the env is already sourced) or through the generated wrapper.
 *
 * `baseOptions` carries the cwd/timeout/stdio settings the caller wants;
 * idfSpawn preserves them. The returned object is suitable for direct
 * destructuring into spawnSync: `const inv = idfSpawn(...); spawnSync(inv.command, inv.args, inv.options)`.
 */
export function idfSpawn(projectDir: string, idfArgs: string[], baseOptions: SpawnSyncOptions): IdfInvocation {
  const env = detectIdfEnv();
  if (env.available) {
    // Direct invocation — zero overhead, env already sourced in this shell.
    return { command: 'idf.py', args: idfArgs, options: baseOptions };
  }

  // Need to activate. Discover the root, then load the cached env (or capture it).
  const root = discoverIdfRoot();
  if (!root) {
    throw new Error(env.message);
  }

  const cachedEnv = loadOrCaptureEnv(root);
  if (cachedEnv) {
    // Fast path: use cached env directly. No wrapper, no export.bat sourcing.
    // idf.py is called directly with the cached environment.
    // Enable ccache for faster cold builds (IDF disables it by default).
    const { shell: _drop, ...optsWithoutShell } = baseOptions as any;
    const envWithCcache = { ...cachedEnv, IDF_CCACHE_ENABLE: '1' };
    return {
      command: 'idf.py',
      args: idfArgs,
      options: { ...optsWithoutShell, env: envWithCcache },
      activation: {
        activated: true,
        root,
        wrapperPath: '',
        message: `[framework-esp32] Using cached ESP-IDF ${root.version ?? ''} env from ${root.path} (discovered via ${root.source})`,
      },
    };
  }

  // Fallback: wrapper-based activation (slower but works if capture fails).
  const activation = ensureIdfActivated(projectDir);
  const wrapperPath = activation.wrapperPath;

  if (IS_WIN) {
    const cmdLine = `"${wrapperPath}" ${idfArgs.join(' ')}`;
    const childEnv = scrubMsysEnv({ ...process.env }) as NodeJS.ProcessEnv;
    return {
      command: 'cmd.exe',
      args: ['/d', '/s', '/c', cmdLine],
      options: { ...baseOptions, env: childEnv },
      activation,
    };
  }
  return {
    command: 'bash',
    args: ['-c', `"${wrapperPath}" "$@"`, 'bash', ...idfArgs],
    options: baseOptions,
    activation,
  };
}
