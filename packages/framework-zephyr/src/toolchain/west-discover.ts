// ---------------------------------------------------------------------------
// west discovery — find a usable `west` (and the Zephyr SDK / ZEPHYR_BASE)
//
// west installs into a Python venv that must be activated before `west` is on
// PATH. We resolve a working invocation WITHOUT requiring the user to have
// activated the venv, by preferring the robust `<python> -m west` form: it
// sidesteps shebang-launcher fragility on Windows and works with any venv
// once we know which Python interpreter has west installed.
//
// Discovery cascade (first usable wins):
//   1. `west` already on PATH (env already activated / global install).
//   2. $ZEPHYR_BASE venv: ${ZEPHYR_BASE}/../.venv/<python> -m west.
//   3. micromamba env from @typecad/zephyr-installer (invoked via `micromamba run`,
//      so typecad-hal builds work with NO manual activation).
//   4. Well-known workspace layouts: ~/zephyrproject/.venv, /opt/zephyrproject/.
//      venv, etc.
//   5. System pythons (`python`, `python3`, `py`) via `-m west`.
//
// Leaner than the ESP-IDF equivalent: west needs no env sourcing (no 15s
// export.sh) — only the right interpreter + ZEPHYR_BASE.
// ---------------------------------------------------------------------------

import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';
import { spawnSync } from 'node:child_process';

const IS_WIN = process.platform === 'win32';

/** The Python executable name inside a venv's bin/ (POSIX) or Scripts/ (Win). */
function venvPython(venvDir: string): string {
  return join(venvDir, IS_WIN ? 'Scripts' : 'bin', IS_WIN ? 'python.exe' : 'python');
}

/** True if `exe` runs `python -m west --version` successfully. */
function pythonRunsWest(exe: string): boolean {
  try {
    const r = spawnSync(exe, ['-m', 'west', '--version'], {
      encoding: 'utf8',
      timeout: 15_000,
      windowsHide: true,
    });
    return r.status === 0;
  } catch {
    return false;
  }
}

/** True if `cmd` runs `west --version` successfully. `cmd` comes from
 * `where`/`which` output — a venv launcher (west.exe) or script path, spawned
 * without a shell like every other command in this module. */
function westOnPath(cmd: string): boolean {
  try {
    const r = spawnSync(cmd, ['--version'], {
      encoding: 'utf8',
      timeout: 15_000,
      windowsHide: true,
    });
    return r.status === 0;
  } catch {
    return false;
  }
}

/**
 * A discovered, usable west installation. `mode` tells the caller how to
 * invoke it: 'launcher' = call `westExecutable` directly; 'module' = call
 * `pythonExecutable -m west`.
 */
export interface WestInstall {
  mode: 'launcher' | 'module' | 'micromamba';
  /** Absolute path to a `west` launcher (mode 'launcher') or undefined. */
  westExecutable?: string;
  /** Absolute path to a Python interpreter with west installed (mode 'module'). */
  pythonExecutable?: string;
  /** Absolute path to the Zephyr workspace (for $ZEPHYR_BASE), if found. */
  zephyrBase?: string;
  /** Absolute path to the Zephyr SDK install dir (hosttools/openocd lives
   *  there), if found — used to put the SDK's openocd on the flash PATH. */
  sdkInstallDir?: string;
  /** mode 'micromamba': path to the micromamba binary (for `micromamba run -n …`). */
  micromambaExe?: string;
  /** mode 'micromamba': the conda env name (default 'zephyr'). */
  envName?: string;
  /** mode 'micromamba': MAMBA_ROOT_PREFIX, injected so micromamba finds its envs. */
  mambaRootPrefix?: string;
  /** Which discovery strategy found this install. */
  source: 'path' | 'zephyr-base-venv' | 'well-known' | 'system-python' | 'micromamba';
}

/** True if `dir` looks like a Zephyr SDK root: has CMakeLists.txt and the
 *  kernel header. */
export function isZephyrBase(dir: string): boolean {
  if (!dir) return false;
  return (
    existsSync(join(dir, 'CMakeLists.txt')) &&
    existsSync(join(dir, 'include', 'zephyr', 'kernel.h'))
  );
}

// ── Strategy 1: `west` on PATH ──────────────────────────────────────────────

export function discoverFromPath(): WestInstall | null {
  // No shell: `where`/`which` are plain executables Node resolves from PATH
  // (where.exe is a real PE, not a cmd builtin), and an args array with a
  // truthy shell triggers Node's DEP0190 deprecation warning.
  const which = spawnSync(IS_WIN ? 'where' : 'which', ['west'], {
    encoding: 'utf8',
    windowsHide: true,
  });
  if (which.status !== 0) return null;
  const lines = (which.stdout ?? '').split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  for (const line of lines) {
    if (!existsSync(line)) continue;
    if (!westOnPath(line)) continue;
    return {
      mode: 'launcher',
      westExecutable: line,
      zephyrBase: process.env.ZEPHYR_BASE || undefined,
      source: 'path',
    };
  }
  return null;
}

// ── Strategy 2: $ZEPHYR_BASE sibling venv ───────────────────────────────────

/** The canonical Zephyr workspace layout puts the venv beside the SDK:
 *  <workspace>/{.venv, zephyr}. So ${ZEPHYR_BASE}/../.venv is the venv. */
export function discoverFromZephyrBase(): WestInstall | null {
  const zb = process.env.ZEPHYR_BASE;
  if (!zb || !isZephyrBase(zb)) return null;
  const workspaceDir = dirname(zb);
  const venvDir = join(workspaceDir, '.venv');
  const py = venvPython(venvDir);
  if (!existsSync(py) || !pythonRunsWest(py)) return null;
  return {
    mode: 'module',
    pythonExecutable: py,
    zephyrBase: zb,
    source: 'zephyr-base-venv',
  };
}

/** The installer-written SDK dir for the default micromamba env, when the
 *  installer has run on this machine. Read WITHOUT requiring micromamba
 *  mode — a PATH/venv west install is enriched with it so builds spawned
 *  through it still pin the installer's SDK (otherwise Zephyr's CMake
 *  searches $HOME and can pick up a stray, older SDK). */
export function installerSdkDir(): string | undefined {
  const mm = findMicromamba();
  if (!mm) return undefined;
  const envName = process.env.TYPECAD_ZEPHYR_ENV || 'zephyr';
  const envDir = join(mm.rootPrefix, 'envs', envName);
  if (!existsSync(envDir)) return undefined;
  const sdk = readMicromambaEnvVar(envDir, 'TYPECAD_ZEPHYR_SDK_INSTALL_DIR');
  return sdk && existsSync(sdk) ? sdk : undefined;
}

/**
 * The micromamba env created by `@typecad/zephyr-installer`. The env's west
 * lives at envs/<name>/bin/west (POSIX) or Scripts/west.exe (Windows). Found
 * installs are invoked via `micromamba run -n <name> west …` (see
 * west-spawn.ts), which sets up the env's full PATH (cmake/ninja/dtc) AND runs
 * the activation hook (ZEPHYR_BASE / ZEPHYR_SDK_INSTALL_DIR) — so builds work
 * with NO manual `micromamba activate`. This is what makes a fresh
 * `typecad-hal build` succeed in any project without the user activating.
 *
 * Env name defaults to "zephyr"; override via TYPECAD_ZEPHYR_ENV. File-check
 * based (no spawn) so it's cheap to run on every invocation.
 */
// ── Strategy 3: micromamba env (the @typecad/zephyr-installer install) ─────

// Locate the micromamba binary + root prefix. The installer downloads
// micromamba to $MAMBA_ROOT_PREFIX/bin (POSIX) or Library/bin (Windows); the
// root defaults to ~/micromamba. Returns null if the binary isn't present
// (the installer hasn't run on this machine).
function findMicromamba(): { exe: string; rootPrefix: string } | null {
  const root = process.env.MAMBA_ROOT_PREFIX || join(homedir(), 'micromamba');
  const exe = IS_WIN
    ? join(root, 'Library', 'bin', 'micromamba.exe')
    : join(root, 'bin', 'micromamba');
  return existsSync(exe) ? { exe, rootPrefix: root } : null;
}

/** Read a TYPECAD_ZEPHYR_* value from the installer-written env-vars file in
 *  a micromamba env. Handles .sh (export VAR="val"), .bat (set "VAR=val"),
 *  and .ps1 ($env:VAR = "val"). Returns undefined if absent/unreadable. */
function readMicromambaEnvVar(envDir: string, varName: string): string | undefined {
  const candidates = IS_WIN
    ? [join(envDir, 'etc', 'conda', 'env-vars.ps1'), join(envDir, 'etc', 'conda', 'env-vars.bat')]
    : [join(envDir, 'etc', 'conda', 'env-vars.sh')];
  for (const f of candidates) {
    if (!existsSync(f)) continue;
    try {
      const text = readFileSync(f, 'utf8');
      // .sh/.ps1: VAR = "value" (quoted value after =).
      let m = text.match(new RegExp(`${varName}\\s*=\\s*"([^"]+)"`));
      if (m) return m[1];
      // .bat: set "VAR=value" (value after VAR= inside quotes).
      m = text.match(new RegExp(`${varName}=([^"\\r\\n]+)"`));
      if (m) return m[1].trim();
    } catch { /* ignore unreadable */ }
  }
  return undefined;
}

/** The installer-written ZEPHYR_BASE of the micromamba env, fs-only (no
 *  spawn) — the cheap probe shared by board-catalog overlay discovery.
 *  Undefined when the installer env or its env-vars file is absent. */
export function micromambaZephyrBase(
  envName: string = process.env.TYPECAD_ZEPHYR_ENV || 'zephyr',
): string | undefined {
  const mm = findMicromamba();
  if (!mm) return undefined;
  const envDir = join(mm.rootPrefix, 'envs', envName);
  const zb = readMicromambaEnvVar(envDir, 'TYPECAD_ZEPHYR_BASE');
  return zb && isZephyrBase(zb) ? zb : undefined;
}

export function discoverFromMicromamba(
  envName: string = process.env.TYPECAD_ZEPHYR_ENV || 'zephyr',
): WestInstall | null {
  const mm = findMicromamba();
  if (!mm) return null;
  const envDir = join(mm.rootPrefix, 'envs', envName);
  const westExe = join(envDir, IS_WIN ? 'Scripts' : 'bin', IS_WIN ? 'west.exe' : 'west');
  if (!existsSync(envDir) || !existsSync(westExe)) return null;
  // Read ZEPHYR_BASE from the installer's env-vars so the compat check (and
  // anything else in the cuttlefish process) can detect the Zephyr version
  // WITHOUT activation — micromamba run sets it only inside the west subprocess.
  const zb = readMicromambaEnvVar(envDir, 'TYPECAD_ZEPHYR_BASE');
  const sdk = readMicromambaEnvVar(envDir, 'TYPECAD_ZEPHYR_SDK_INSTALL_DIR');
  return {
    mode: 'micromamba',
    micromambaExe: mm.exe,
    envName,
    mambaRootPrefix: mm.rootPrefix,
    zephyrBase: zb && isZephyrBase(zb) ? zb : undefined,
    sdkInstallDir: sdk && existsSync(sdk) ? sdk : undefined,
    source: 'micromamba',
  };
}

// ── Strategy 4: well-known workspace layouts ───────────────────────────────

/** Candidate Zephyr workspace directories. Each may contain both `.venv/`
 *  and `zephyr/` (the SDK). Exported for test injection. */
export function wellKnownWorkspaces(): string[] {
  const home = homedir();
  if (IS_WIN) {
    return [
      join(home, 'zephyrproject'),
      join(home, 'zephyr'),
      'C:\\zephyrproject',
      'C:\\zephyr',
    ];
  }
  return [
    join(home, 'zephyrproject'),
    join(home, 'zephyr'),
    '/opt/zephyrproject',
    '/opt/zephyr',
  ];
}

export function discoverFromWellKnown(
  workspaces: string[] = wellKnownWorkspaces(),
): WestInstall | null {
  for (const ws of workspaces) {
    const venvDir = join(ws, '.venv');
    const py = venvPython(venvDir);
    if (!existsSync(py) || !pythonRunsWest(py)) continue;
    // Resolve ZEPHYR_BASE if the SDK sits beside the venv.
    const zb = join(ws, 'zephyr');
    return {
      mode: 'module',
      pythonExecutable: py,
      zephyrBase: isZephyrBase(zb) ? zb : undefined,
      source: 'well-known',
    };
  }
  return null;
}

// ── Strategy 5: system pythons via `-m west` ────────────────────────────────

/** Candidate system Python interpreters to probe with `-m west`. */
export function systemPythons(): string[] {
  if (IS_WIN) return ['py', 'python', 'python3'];
  return ['python3', 'python'];
}

export function discoverFromSystemPython(
  pythons: string[] = systemPythons(),
): WestInstall | null {
  for (const py of pythons) {
    if (!pythonRunsWest(py)) continue;
    return {
      mode: 'module',
      pythonExecutable: py,
      zephyrBase: process.env.ZEPHYR_BASE || undefined,
      source: 'system-python',
    };
  }
  return null;
}

// ── Top-level cascade ────────────────────────────────────────────────────────

let cachedDiscover: WestInstall | null | undefined;

/** Clear the process-local discovery cache (for tests). */
export function resetWestDiscoveryCache(): void {
  cachedDiscover = undefined;
}

/**
 * Try each discovery strategy in order. The first usable install wins.
 * Result is memoized for the process lifetime (west installs don't move).
 *
 * Order: PATH → $ZEPHYR_BASE venv → micromamba env → well-known workspaces →
 * system pythons.
 * Returns null when no usable west install is found.
 */
export function discoverWest(): WestInstall | null {
  if (cachedDiscover !== undefined) return cachedDiscover;
  const strategies: Array<() => WestInstall | null> = [
    discoverFromPath,
    discoverFromZephyrBase,
    discoverFromMicromamba,
    discoverFromWellKnown,
    discoverFromSystemPython,
  ];
  for (const strat of strategies) {
    let install: WestInstall | null = null;
    try {
      install = strat();
    } catch {
      install = null;
    }
    if (install) {
      // A PATH/venv west install knows nothing about the installer's SDK.
      // Enrich it: west-spawn pins the child's ZEPHYR_SDK_INSTALL_DIR to the
      // installer dir, so Zephyr's CMake cannot pick up a stray SDK from
      // $HOME (a version mismatch that only surfaces at configure time).
      if (!install.sdkInstallDir) {
        install.sdkInstallDir = installerSdkDir();
      }
      cachedDiscover = install;
      return install;
    }
  }
  cachedDiscover = null;
  return null;
}
