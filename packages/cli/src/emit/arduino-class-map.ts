/**
 * Arduino class name mapping — thin re-export from @typecode/framework-arduino
 */
import { loadFrameworkPackage } from "../framework-package";

const FRAMEWORK_PACKAGE = "@typecode/framework-arduino";

function getArduinoFramework(): any {
  return loadFrameworkPackage(FRAMEWORK_PACKAGE, process.cwd());
}

export function buildArduinoClassNameMap(imports: unknown): Map<string, string> | undefined {
  return getArduinoFramework().buildArduinoClassNameMap(imports);
}

export type ArduinoImportLike = unknown;