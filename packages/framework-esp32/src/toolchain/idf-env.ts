import { spawnSync } from 'node:child_process';

export interface IdfEnvStatus {
  available: boolean;
  reason?: 'idf-path-missing' | 'idfpy-not-on-path';
  idfPath?: string;
  idfToolsPath?: string;
  message: string;
}

/**
 * Validate that the calling shell has a sourced ESP-IDF environment.
 * We do NOT try to source it ourselves — that's a per-shell-session setup
 * the user owns (matches how ESP-IDF users already work).
 */
export function detectIdfEnv(): IdfEnvStatus {
  const idfPath = process.env.IDF_PATH;
  if (!idfPath) {
    return {
      available: false,
      reason: 'idf-path-missing',
      message: [
        'ESP-IDF environment not detected: $IDF_PATH is not set.',
        'Source the ESP-IDF environment before running cuttlefish:',
        '  POSIX:  . $IDF_PATH/export.sh',
        '  Windows: %IDF_PATH%\\export.bat',
        'Or use the ESP-IDF VS Code extension which sets the env on terminal open.',
      ].join('\n'),
    };
  }

  const which = spawnSync(process.platform === 'win32' ? 'where' : 'which', ['idf.py'], {
    encoding: 'utf8',
    shell: true,
  });
  if (which.status !== 0) {
    return {
      available: false,
      reason: 'idfpy-not-on-path',
      idfPath,
      message: `idf.py not found on $PATH (IDF_PATH=${idfPath}). Re-run the export script.`,
    };
  }

  return {
    available: true,
    idfPath,
    idfToolsPath: process.env.IDF_TOOLS_PATH,
    message: 'ESP-IDF environment active.',
  };
}

/** Throw a structured error if the env is missing. */
export function requireIdfEnv(): void {
  const status = detectIdfEnv();
  if (!status.available) {
    throw new Error(status.message);
  }
}
