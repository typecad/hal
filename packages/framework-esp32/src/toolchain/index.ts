import { dirname, basename, join } from 'node:path';
import type { ToolchainOptions, CompileResult, UploadResult } from '@typecad/cuttlefish/api/shared';
import { parseCompileErrors } from '@typecad/cuttlefish/api/shared';
import { compileEspIdf } from './compile.js';
import { uploadEspIdf } from './upload.js';
import { monitorEspIdf } from './monitor.js';
import { writeDebugConfig, resolveDebugLocations } from './debug-config.js';
import { normalizeIdfTarget } from '../lowering/util.js';
import { resolveComponents } from '../components/types.js';
import { Esp32Strategy } from '../strategy.js';

function targetFromOptions(o: ToolchainOptions): string {
  // The cuttlefish CLI populates ToolchainOptions.buildTarget from
  // config.frameworkData.buildTarget. Accept bare IDF targets or Arduino FQBNs.
  const t = (o.buildTarget as string | undefined)
    ?? (o.frameworkConfig?.target as string | undefined)
    ?? 'esp32';
  return normalizeIdfTarget(t);
}

/**
 * Derive the ESP-IDF project root from the cuttlefish-emitted source path.
 *
 * Cuttlefish emits `main/main.cc` (entry file) under the output dir. The CLI
 * passes `sourcePath` = full path to `main.cc` and `outputDir` = its parent
 * (`main/`). For ESP-IDF, the project root is the parent of `main/` — i.e.
 * one level above `outputDir`. Detect that shape and adjust; if the path
 * doesn't end in `/main/<basename>.cc`, fall back to `outputDir`.
 *
 * Exported for testing.
 */
export function projectRootFromOptions(o: ToolchainOptions): string {
  const outDir = o.outputDir;
  // If outputDir's basename is 'main', the project root is its parent.
  if (basename(outDir) === 'main') {
    return dirname(outDir);
  }
  return outDir;
}

/**
 * FrameworkToolchain impl for ESP-IDF. Spec §3.5.
 * The IDF target is carried via frameworkData.buildTarget (populated as
 * ToolchainOptions.buildTarget by the cuttlefish CLI). prepare is a no-op —
 * scaffolding happens at compile time when the target is known.
 */
export const Toolchain = {
  prepare(_outputDir: string, _entryPoint: string): void {
    // no-op — scaffold happens in compile()
  },
  compile(o: ToolchainOptions): CompileResult {
    // projectRoot is the dir holding cuttlefish.config.ts — the same dir the
    // resolver uses to anchor relative component paths.
    const projectRoot = projectRootFromOptions(o);
    const components = resolveComponents(o.frameworkConfig, projectRoot);
    const r = compileEspIdf({
      sourcePath: projectRoot,
      target: targetFromOptions(o),
      defines: o.defines,
      extraFlags: o.extraFlags,
      components,
    });

    // After a successful build in gdb mode (esp32s3), write the VS Code/OpenOCD/
    // sdkconfig/gdb-script artifacts so F5 attaches GDB to the chip's USB-Serial-
    // JTAG. Non-fatal on failure — a missing artifact doesn't block the build.
    //
    // VS Code only reads .vscode/ from the workspace root (the folder the user
    // has open). In a monorepo that's almost always the git root, NOT the sketch
    // dir — so we resolve the git root from cwd and write there, with launch.json
    // paths expressed relative to it (e.g. ${workspaceFolder}/demos/demo/...).
    if (r.success) {
      const target = targetFromOptions(o);
      const debugMode = new Esp32Strategy().debugMode(target);
      if (debugMode === 'gdb') {
        try {
          const { workspaceRoot, sketchRel } = resolveDebugLocations(process.cwd());
          writeDebugConfig({
            projectRoot,
            // ELF base name matches what the scaffold writes to CMakeLists:
            // project(${basename(projectDir)}). Verified against prior builds
            // (e.g. demos/rmt-demo produces out-esp32s3.elf).
            projectName: basename(projectRoot),
            sketchRel,
            port: o.port ?? '',
            target,
            workspaceRoot,
            sourceMapPath: join(projectRoot, 'main', 'main.cc.thcppmap.json'),
          });
        } catch (e) {
          console.warn(`[cuttlefish] gdb debug config generation failed: ${(e as Error).message}`);
        }
      }
    }

    return {
      success: r.success,
      output: r.output,
      errors: parseCompileErrors(r.output, o.sourcePath),
    };
  },
  upload(o: ToolchainOptions): UploadResult {
    const r = uploadEspIdf(projectRootFromOptions(o), o.port ?? '');
    return {
      success: r.success,
      output: r.output,
    };
  },
  monitor(o: ToolchainOptions): void {
    monitorEspIdf(o.port ?? '', projectRootFromOptions(o));
  },
};
