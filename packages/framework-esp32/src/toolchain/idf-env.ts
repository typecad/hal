import { spawnSync } from 'node:child_process';
import { type IdfRoot, discoverIdfRoot } from './discover.js';

export interface IdfEnvStatus {
  available: boolean;
  reason?: 'idf-path-missing' | 'idfpy-not-on-path';
  idfPath?: string;
  idfToolsPath?: string;
  /** Populated when the env is not sourced but a discovery strategy found an
   *  installed IDF root. Carries the root that the activation layer will use
   *  to source export.{sh,bat} automatically. Undefined when no install is found. */
  discoveredRoot?: IdfRoot;
  message: string;
}

/**
 * Validate the ESP-IDF environment in the current shell.
 *
 * Returns `{available: true}` when $IDF_PATH is set AND idf.py is on $PATH
 * (the env is fully sourced and idf.py can be called directly).
 *
 * Returns `{available: false, discoveredRoot, ...}` when the env is NOT
 * sourced but auto-discovery found an installed IDF root. The activation
 * layer (activate.ts) uses discoveredRoot to source export.{sh,bat} via a
 * generated wrapper — callers don't need to do anything special, but the
 * message is surfaced for transparency.
 *
 * Returns `{available: false}` with no discoveredRoot when no install is
 * found at all; the message tells the user how to install/source ESP-IDF.
 */
export function detectIdfEnv(): IdfEnvStatus {
  const idfPath = process.env.IDF_PATH;
  const discoveredRoot = discoverIdfRoot();

  if (!idfPath) {
    const baseHelp = [
      'ESP-IDF environment not detected: $IDF_PATH is not set.',
    ];
    if (discoveredRoot) {
      baseHelp.push(
        `However, an ESP-IDF install was discovered at: ${discoveredRoot.path}`,
        `(version ${discoveredRoot.version ?? 'unknown'}, via ${discoveredRoot.source}).`,
        'It will be auto-sourced on the next compile/upload/monitor call.',
        'To source it manually in this shell:',
        `  POSIX:  . ${discoveredRoot.path}/export.sh`,
        `  Windows: ${discoveredRoot.path}\\export.bat`,
      );
    } else {
      baseHelp.push(
        'Source the ESP-IDF environment before running cuttlefish:',
        '  POSIX:  . $IDF_PATH/export.sh',
        '  Windows: %IDF_PATH%\\export.bat',
        'Or install ESP-IDF via the ESP-IDF Installation Manager (EIM).',
      );
    }
    return {
      available: false,
      reason: 'idf-path-missing',
      discoveredRoot: discoveredRoot ?? undefined,
      message: baseHelp.join('\n'),
    };
  }

  const which = spawnSync(process.platform === 'win32' ? 'where' : 'which', ['idf.py'], {
    encoding: 'utf8',
    shell: true,
  });
  if (which.status !== 0) {
    // IDF_PATH is set but idf.py isn't on PATH — env was partially configured.
    const msg = [
      `idf.py not found on $PATH (IDF_PATH=${idfPath}).`,
    ];
    if (discoveredRoot) {
      msg.push(
        `An ESP-IDF install was discovered at: ${discoveredRoot.path}`,
        'It will be auto-sourced on the next compile/upload/monitor call.',
      );
    } else {
      msg.push('Re-run the export script to put idf.py on PATH.');
    }
    return {
      available: false,
      reason: 'idfpy-not-on-path',
      idfPath,
      discoveredRoot: discoveredRoot ?? undefined,
      message: msg.join('\n'),
    };
  }

  return {
    available: true,
    idfPath,
    idfToolsPath: process.env.IDF_TOOLS_PATH,
    message: 'ESP-IDF environment active.',
  };
}

/** Throw a structured error if the env is missing AND no install is discoverable.
 *  Note: this does NOT throw when discovery succeeds — the activation layer
 *  handles that case. Callers that want auto-source should use idfSpawn()
 *  from activate.ts rather than this function. */
export function requireIdfEnv(): void {
  const status = detectIdfEnv();
  if (!status.available && !status.discoveredRoot) {
    throw new Error(status.message);
  }
}
