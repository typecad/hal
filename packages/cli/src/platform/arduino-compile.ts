// ---------------------------------------------------------------------------
// Arduino compile / upload / monitor — delegates to the loaded framework
//
// Types are re-exported for consumer convenience.  Value exports are accessed
// through the framework API registry so that no static framework dependency
// exists at compile time.
// ---------------------------------------------------------------------------

export type { ArduinoCompileResult, ArduinoUploadResult } from "@typecode/core";

import { getFrameworkApi } from "../framework-api";

export function flattenGeneratedModulesIntoSketch(sketchDir: string, sketchPath: string): void {
  return getFrameworkApi().flattenGeneratedModulesIntoSketch(sketchDir, sketchPath);
}

export function compileArduinoSketch(sketchFilePath: string, fqbn: string) {
  return getFrameworkApi().compileArduinoSketch(sketchFilePath, fqbn);
}

export function uploadArduinoSketch(sketchDir: string, fqbn: string, port: string) {
  return getFrameworkApi().uploadArduinoSketch(sketchDir, fqbn, port);
}

export function monitorArduinoSketch(port: string, baud: number): void {
  return getFrameworkApi().monitorArduinoSketch(port, baud);
}
