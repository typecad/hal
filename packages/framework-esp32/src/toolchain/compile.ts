import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { scaffoldEspIdfProject } from './scaffold.js';
import { idfSpawn } from './activate.js';

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
 *
 * Env activation is automatic: if $IDF_PATH isn't sourced but a discovery
 * strategy finds an install, idfSpawn generates a wrapper that sources
 * export.{sh,bat} and runs idf.py through it.
 */
export function compileEspIdf(options: EspIdfCompileOptions): EspIdfCompileResult {
  // Scaffold FIRST, before env detection, so the user can inspect/edit the
  // project files (CMakeLists.txt, sdkconfig.defaults) even on machines
  // without ESP-IDF installed.
  scaffoldEspIdfProject(options.sourcePath, options.target);

  // idfSpawn throws if discovery fails entirely (no install + no env) — catch
  // and convert to the result shape so the message surfaces cleanly.
  try {
    // First-time setup: run `idf.py set-target <chip>` to generate sdkconfig.
    const sdkconfigPath = `${options.sourcePath}/sdkconfig`;
    if (!existsSync(sdkconfigPath)) {
      const setupInv = idfSpawn(options.sourcePath, ['set-target', options.target], {
        cwd: options.sourcePath,
        encoding: 'utf8',
        timeout: 180000,
      });
      const setup = spawnSync(setupInv.command, setupInv.args, setupInv.options);
      if (setup.status !== 0) {
        const activationNotice = setupInv.activation?.message ? `${setupInv.activation.message}\n` : '';
        return {
          success: false,
          output: activationNotice + (setup.stdout ?? '') + (setup.stderr ?? ''),
          errorMessage: `idf.py set-target ${options.target} failed with exit ${setup.status}`,
        };
      }
    }

    // Build.
    const args = ['build'];
    for (const [k, v] of Object.entries(options.defines ?? {})) {
      args.push('-D', `${k}=${v}`);
    }
    args.push(...(options.extraFlags ?? []));

    const buildInv = idfSpawn(options.sourcePath, args, {
      cwd: options.sourcePath,
      encoding: 'utf8',
      timeout: 300000,
    });
    const result = spawnSync(buildInv.command, buildInv.args, buildInv.options);
    const activationNotice = buildInv.activation?.message ? `${buildInv.activation.message}\n` : '';

    return {
      success: result.status === 0,
      output: activationNotice + (result.stdout ?? '') + (result.stderr ?? ''),
      errorMessage: result.status !== 0 ? `idf.py build exited with ${result.status}` : undefined,
    };
  } catch (e) {
    // Discovery failure (no ESP-IDF found at all) — surface the actionable message.
    const msg = (e as Error).message;
    return { success: false, output: msg, errorMessage: msg };
  }
}
