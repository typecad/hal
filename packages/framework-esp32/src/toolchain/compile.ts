import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { requireIdfEnv } from './idf-env.js';
import { scaffoldEspIdfProject } from './scaffold.js';

export interface EspIdfCompileOptions {
  sourcePath: string;
  target: string;
  defines?: Record<string, string>;
  extraFlags?: string[];
}

export interface EspIdfCompileResult {
  success: boolean;
  output: string;
  errorMessage?: string;
}

/**
 * Compile an ESP-IDF project via `idf.py build`. Scaffolds the project
 * skeleton if missing, runs set-target on first build, then builds.
 * Spec §3.4.
 */
export function compileEspIdf(options: EspIdfCompileOptions): EspIdfCompileResult {
  // Scaffold FIRST, before env detection, so the user can inspect/edit the
  // project files (CMakeLists.txt, sdkconfig.defaults) even on machines
  // without ESP-IDF installed. The actual build needs the env, but the
  // project skeleton is useful on its own.
  scaffoldEspIdfProject(options.sourcePath, options.target);

  try {
    requireIdfEnv();
  } catch (e) {
    // Put the message in `output` (not just errorMessage) so the CLI's
    // console.error(compileResult.output) fallback actually prints it.
    const msg = (e as Error).message;
    return { success: false, output: msg, errorMessage: msg };
  }

  const sdkconfigPath = `${options.sourcePath}/sdkconfig`;
  if (!existsSync(sdkconfigPath)) {
    const setup = spawnSync('idf.py', ['set-target', options.target], {
      cwd: options.sourcePath,
      encoding: 'utf8',
      shell: true,
      timeout: 180000,
    });
    if (setup.status !== 0) {
      return {
        success: false,
        output: (setup.stdout ?? '') + (setup.stderr ?? ''),
        errorMessage: `idf.py set-target ${options.target} failed with exit ${setup.status}`,
      };
    }
  }

  const args = ['build'];
  for (const [k, v] of Object.entries(options.defines ?? {})) {
    args.push('-D', `${k}=${v}`);
  }
  args.push(...(options.extraFlags ?? []));

  const result = spawnSync('idf.py', args, {
    cwd: options.sourcePath,
    encoding: 'utf8',
    shell: true,
    timeout: 300000,
  });

  return {
    success: result.status === 0,
    output: (result.stdout ?? '') + (result.stderr ?? ''),
    errorMessage: result.status !== 0 ? `idf.py build exited with ${result.status}` : undefined,
  };
}
