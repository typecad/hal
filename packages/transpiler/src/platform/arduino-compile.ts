// ---------------------------------------------------------------------------
// Arduino Compile / Upload / Monitor (backward-compatible wrappers)
//
// Delegates to the generic toolchain layer. These named exports are kept
// for backward compatibility with code that imports from this path directly.
// New code should use compileSource/uploadFirmware/monitorDevice from
// platform/toolchain instead.
// ---------------------------------------------------------------------------

import { compileSource, uploadFirmware, monitorDevice } from "./toolchain";
import type { CompileResult, UploadResult } from "@typehal/core/shared";

/** @deprecated Use prepareOutput() from platform/toolchain */
export function flattenGeneratedModulesIntoSketch(outputDir: string, entryPoint: string): void {
  const { getLoadedFramework, hasLoadedFramework } = require("../framework-registry");
  if (hasLoadedFramework()) {
    const { toolchain } = getLoadedFramework();
    toolchain?.prepare?.(outputDir, entryPoint);
  }
}

/** @deprecated Use compileSource() from platform/toolchain */
export function compileArduinoSketch(sourcePath: string, fqbn: string): CompileResult {
  return compileSource({ outputDir: sourcePath, sourcePath, fqbn });
}

/** @deprecated Use uploadFirmware() from platform/toolchain */
export function uploadArduinoSketch(sketchDir: string, fqbn: string, port: string): UploadResult {
  return uploadFirmware({ outputDir: sketchDir, sourcePath: sketchDir, fqbn, port });
}

/** @deprecated Use monitorDevice() from platform/toolchain */
export function monitorArduinoSketch(port: string, baud: number): void {
  return monitorDevice({ outputDir: process.cwd(), sourcePath: "", port, baud });
}
