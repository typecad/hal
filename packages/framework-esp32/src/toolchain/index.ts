import type { ToolchainOptions, CompileResult, UploadResult } from '@typecad/cuttlefish/api/shared';
import { parseCompileErrors } from '@typecad/cuttlefish/api/shared';
import { compileEspIdf } from './compile.js';
import { uploadEspIdf } from './upload.js';
import { monitorEspIdf } from './monitor.js';

function targetFromOptions(o: ToolchainOptions): string {
  return (o.frameworkConfig?.target as string | undefined) ?? 'esp32';
}

/**
 * FrameworkToolchain impl for ESP-IDF. Spec §3.5.
 * The IDF target is carried via frameworkConfig.target (NOT buildTarget,
 * which is the FQBN-style field). prepare is a no-op — scaffolding happens
 * at compile time when the target is known.
 */
export const Toolchain = {
  prepare(_outputDir: string, _entryPoint: string): void {
    // no-op — scaffold happens in compile()
  },
  compile(o: ToolchainOptions): CompileResult {
    const r = compileEspIdf({
      sourcePath: o.sourcePath,
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
    const r = uploadEspIdf(o.outputDir, o.port ?? '');
    return {
      success: r.success,
      output: r.output,
    };
  },
  monitor(o: ToolchainOptions): void {
    monitorEspIdf(o.port ?? '');
  },
};
