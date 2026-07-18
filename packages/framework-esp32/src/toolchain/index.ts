import { dirname, basename } from 'node:path';
import type { ToolchainOptions, CompileResult, UploadResult } from '@typecad/cuttlefish/api/shared';
import { parseCompileErrors } from '@typecad/cuttlefish/api/shared';
import { compileEspIdf } from './compile.js';
import { uploadEspIdf } from './upload.js';
import { monitorEspIdf } from './monitor.js';

function targetFromOptions(o: ToolchainOptions): string {
  // The cuttlefish CLI populates ToolchainOptions.buildTarget from
  // config.frameworkData.buildTarget (see cli.ts:462/503/etc.). We read that
  // as the IDF target string ('esp32' | 'esp32s3' | 'esp32c3' | 'esp32c6').
  // Fall back to frameworkConfig.target for callers that use that field, then
  // to 'esp32' as the default.
  const t = (o.buildTarget as string | undefined)
    ?? (o.frameworkConfig?.target as string | undefined)
    ?? 'esp32';
  return t;
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
    const r = compileEspIdf({
      sourcePath: projectRootFromOptions(o),
      target: targetFromOptions(o),
      defines: o.defines,
      extraFlags: o.extraFlags,
    });
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
