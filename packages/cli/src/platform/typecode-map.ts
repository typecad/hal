import { loadFrameworkPackage } from "../framework-package";

const FRAMEWORK_PACKAGE = "@typecode/framework-arduino";

function getArduinoFramework(): any {
  return loadFrameworkPackage(FRAMEWORK_PACKAGE, process.cwd());
}

/**
 * TypeCode SDK method mapping — thin re-export from @typecode/framework-arduino
 */
export function extractPropertyChain(value: unknown): string[] | undefined {
  return getArduinoFramework().extractPropertyChain(value);
}

export function renderArduinoBuiltin(receiver: string, method: string, args: unknown[]): string {
  return getArduinoFramework().renderArduinoBuiltin(receiver, method, args);
}

export function tryRenderTypecodeCallStatement(receiver: string, method: string, args: unknown[]): string | undefined {
  return getArduinoFramework().tryRenderTypecodeCallStatement(receiver, method, args);
}

export function renderBoardDefinitionAccess(chain: string[], boardConstants: unknown): string | undefined {
  return getArduinoFramework().renderBoardDefinitionAccess(chain, boardConstants);
}