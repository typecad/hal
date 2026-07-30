// ---------------------------------------------------------------------------
// west spawn helper — build a spawnSync invocation for `west <args>`
//
// Mirrors framework-esp32's idfSpawn(): given the discovered WestInstall,
// produce {command, args, env} that the toolchain destructures into spawnSync.
//
// Two modes:
//   - 'launcher': spawn the `west` launcher directly (mode 'launcher').
//   - 'module'  : spawn `<python> -m west ...` (mode 'module'). This is the
//                 robust cross-platform form — it activates the venv's
//                 interpreter for the one process without sourcing anything.
//
// ZEPHYR_BASE is injected into the spawn env when a SDK root was discovered
// (find_package(Zephyr) needs it). west's prj.conf/CMakeLists are found via
// the project dir regardless.
// ---------------------------------------------------------------------------

import type { SpawnSyncOptions } from 'node:child_process';
import { type WestInstall, discoverWest } from './west-discover.js';

export interface WestInvocation {
  /** The command to spawnSync: a `west` launcher or a Python interpreter. */
  command: string;
  /** Args for the command (includes `-m west` when in module mode). */
  args: string[];
  /** Base spawn options with cwd/timeout/encoding/stdio, plus the env carrying
   *  ZEPHYR_BASE when discovered. */
  options: SpawnSyncOptions;
  /** The install the invocation was built from, for surfacing to the user. */
  install: WestInstall;
}

/** The env to pass to the west spawn: the process env, with ZEPHYR_BASE
 *  injected when a SDK root was discovered (and not already set). */
function buildEnv(install: WestInstall): NodeJS.ProcessEnv {
  const env = { ...process.env };
  if (install.zephyrBase && !env.ZEPHYR_BASE) {
    env.ZEPHYR_BASE = install.zephyrBase;
  }
  return env;
}

/**
 * Build a spawn invocation that runs `west <westArgs>`.
 *
 * `baseOptions` carries the cwd/timeout/stdio settings the caller wants;
 * westSpawn preserves them and injects the discovery env. The returned object
 * destructures directly into spawnSync:
 *
 *   const inv = westSpawn(['build', '-b', 'xiao_ble', projectRoot], { cwd, timeout });
 *   spawnSync(inv.command, inv.args, inv.options);
 *
 * Throws a clear, actionable error when no usable west install is discovered.
 */
export function westSpawn(
  westArgs: string[],
  baseOptions: SpawnSyncOptions,
): WestInvocation {
  const install = discoverWest();
  if (!install) {
    throw new Error(
      [
        'west (the Zephyr build tool) was not found.',
        '',
        'cuttlefish looked for it on PATH, in $ZEPHYR_BASE/.venv, in common',
        'Zephyr workspace dirs (~/zephyrproject/.venv), and as a system',
        "Python module (`python -m west`). To fix:",
        '',
        '  • Activate your Zephyr venv in this shell, or',
        '  • Set ZEPHYR_BASE to your Zephyr SDK root (the venv at $ZEPHYR_BASE/../.venv is then used), or',
        '  • Install west into a discoverable Python: pip install west',
        '',
        'See https://docs.zephyrproject.org/latest/develop/getting_started/index.html',
      ].join('\n'),
    );
  }

  const env = buildEnv(install);
  // Strip `shell` if present — we pass absolute paths / known commands, and
  // an explicit shell changes arg-quoting semantics on Windows.
  const { shell: _drop, ...optsWithoutShell } = baseOptions as any;

  if (install.mode === 'launcher' && install.westExecutable) {
    return {
      command: install.westExecutable,
      args: westArgs,
      options: { ...optsWithoutShell, env },
      install,
    };
  }

  // module mode: <python> -m west <args>
  const py = install.pythonExecutable!;
  return {
    command: py,
    args: ['-m', 'west', ...westArgs],
    options: { ...optsWithoutShell, env },
    install,
  };
}
