import { existsSync, readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import type { SpawnSyncOptions } from 'node:child_process';
import { type IdfRoot, discoverIdfRoot } from './discover.js';
import { detectIdfEnv } from './idf-env.js';

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
  const cleanEnv = { ...process.env };
  if (IS_WIN) {
    for (const k of Object.keys(cleanEnv)) {
      if (k === 'MSYSTEM' || k === 'MSYSTEM_CHOST' || k === 'MSYSTEM_PREFIX'
          || k === 'MINGW_CHOST' || k === 'MINGW_PREFIX' || k === 'MINGW_PACKAGE_PREFIX') {
        delete cleanEnv[k];
      }
    }
  }

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

/** Marker comment embedded in the wrapper so we can detect when the wrapper
 *  already targets the desired root (idempotence check). */
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
    const childEnv = { ...process.env };
    for (const k of Object.keys(childEnv)) {
      if (k === 'MSYSTEM' || k === 'MSYSTEM_CHOST' || k === 'MSYSTEM_PREFIX'
          || k === 'MINGW_CHOST' || k === 'MINGW_PREFIX' || k === 'MINGW_PACKAGE_PREFIX') {
        delete childEnv[k];
      }
    }
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
