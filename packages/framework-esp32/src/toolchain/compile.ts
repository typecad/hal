import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { scaffoldEspIdfProject } from './scaffold.js';
import { idfSpawn } from './activate.js';
import { depsHashChanged, writeDepsHash } from '../components/deps-hash.js';
import { generateComponentDeclsForProject } from '@typecad/cuttlefish/lib/component-decls';
import type { ScaffoldComponents } from '../components/types.js';

export interface EspIdfCompileOptions {
  sourcePath: string;
  target: string;
  defines?: Record<string, string>;
  extraFlags?: string[];
  components?: ScaffoldComponents;
}

export interface EspIdfCompileResult {
  success: boolean;
  output: string;
  errorMessage?: string;
}

/**
 * Decide whether `idf.py reconfigure` must run this build.
 *
 * - depsChanged: the components hash differs from (or has no) on-disk record.
 * - sdkconfigExists: a prior `idf.py set-target` already configured this project.
 *
 * Reconfigure when deps moved OR when this is a fresh project (no sdkconfig)
 * — in the fresh case, set-target runs first and would fetch components, but
 * reconfigure is harmless and ensures managed_components/ is populated even
 * when set-target is skipped on subsequent runs.
 */
export function shouldReconfigure(depsChanged: boolean, sdkconfigExists: boolean): boolean {
  if (depsChanged) return true;
  if (!sdkconfigExists) return true;
  return false;
}

/**
 * Compile an ESP-IDF project via `idf.py build`. Scaffolds the project
 * skeleton, runs `idf.py reconfigure` (when components changed), then
 * `idf.py set-target` on first build, then `idf.py build`.
 *
 * Env activation is automatic: if $IDF_PATH isn't sourced but a discovery
 * strategy finds an install, idfSpawn generates a wrapper that sources
 * export.{sh,bat} and runs idf.py through it.
 */
export function compileEspIdf(options: EspIdfCompileOptions): EspIdfCompileResult {
  const components = options.components ?? { managed: {}, local: [] };
  const hasComponents =
    Object.keys(components.managed).length > 0 || components.local.length > 0;

  // Scaffold FIRST, before env detection, so the user can inspect the project
  // files even on machines without ESP-IDF installed.
  scaffoldEspIdfProject(options.sourcePath, options.target, components);

  const sdkconfigPath = join(options.sourcePath, 'sdkconfig');
  const sdkconfigExists = existsSync(sdkconfigPath);
  const spawnOpts = {
    cwd: options.sourcePath,
    encoding: 'utf8' as const,
    timeout: 300000,
  };

  try {
    // ── reconfigure (only when there are components and the gate says so) ──
    if (hasComponents && shouldReconfigure(depsHashChanged(options.sourcePath, components), sdkconfigExists)) {
      const reconfigInv = idfSpawn(options.sourcePath, ['reconfigure'], spawnOpts);
      const reconfig = spawnSync(reconfigInv.command, reconfigInv.args, reconfigInv.options);
      if (reconfig.status !== 0) {
        const activationNotice = reconfigInv.activation?.message ? `${reconfigInv.activation.message}\n` : '';
        return {
          success: false,
          output: activationNotice + (reconfig.stdout ?? '') + (reconfig.stderr ?? ''),
          errorMessage: `idf.py reconfigure failed with exit ${reconfig.status}`,
        };
      }
      writeDepsHash(options.sourcePath, components);

      // After reconfigure populates managed_components/, regenerate .d.ts
      // stubs so user code can import the component APIs.
      try {
        generateComponentDeclsForProject(options.sourcePath, {
          // idf.py stores managed deps as <namespace>__<name> (slashes → __).
          managed: Object.keys(components.managed).map((spec) => spec.replace('/', '__')),
          local: components.local,
        });
      } catch (genErr) {
        // Non-fatal: gen-decls failure should not block a build. Surface as
        // a notice in the build output.
        console.warn(
          `[cuttlefish] gen-decls for components failed: ${(genErr as Error).message}`,
        );
      }
    }

    // ── set-target (first run only) ───────────────────────────────────────
    if (!sdkconfigExists) {
      const setupInv = idfSpawn(options.sourcePath, ['set-target', options.target], {
        ...spawnOpts,
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

    // ── build ─────────────────────────────────────────────────────────────
    const args = ['build'];
    for (const [k, v] of Object.entries(options.defines ?? {})) {
      args.push('-D', `${k}=${v}`);
    }
    args.push(...(options.extraFlags ?? []));

    const buildInv = idfSpawn(options.sourcePath, args, spawnOpts);
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
