import path from "node:path";
import type { ArduinoCompileResult, ArduinoUploadResult } from "@typehal/framework-arduino";
import { loadFrameworkPackage } from "../framework-package";

const FRAMEWORK_PACKAGE = "@typehal/framework-arduino";

function getArduinoFramework(fromDir: string): any {
  return loadFrameworkPackage(FRAMEWORK_PACKAGE, fromDir);
}

export function flattenGeneratedModulesIntoSketch(outputDir: string, entryPoint: string): void {
  const pkg = getArduinoFramework(path.dirname(entryPoint));
  return pkg.flattenGeneratedModulesIntoSketch(outputDir, entryPoint);
}

export function compileArduinoSketch(sourcePath: string, fqbn: string): ArduinoCompileResult {
  const pkg = getArduinoFramework(path.dirname(sourcePath));
  return pkg.compileArduinoSketch(sourcePath, fqbn);
}

export function uploadArduinoSketch(sketchDir: string, fqbn: string, port: string): ArduinoUploadResult {
  const pkg = getArduinoFramework(sketchDir);
  return pkg.uploadArduinoSketch(sketchDir, fqbn, port);
}

export function monitorArduinoSketch(port: string, baud: number): unknown {
  const pkg = getArduinoFramework(process.cwd());
  return pkg.monitorArduinoSketch(port, baud);
}
