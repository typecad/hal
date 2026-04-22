import type { PolyfillDefinition, PolyfillDomain, PolyfillContext, PolyfillNeed, RuntimePolyfillIR } from "../types";
import { loadFrameworkPackage } from "../../framework-package";

const FRAMEWORK_PACKAGE = "@typecode/framework-arduino";

function getArduinoFramework(): any {
  return loadFrameworkPackage(FRAMEWORK_PACKAGE, process.cwd());
}

function getArduinoAsyncPolyfill(): any {
  return getArduinoFramework().arduinoAsyncPolyfill;
}

export const arduinoAsyncPolyfill: PolyfillDefinition = {
  get id(): string {
    return getArduinoAsyncPolyfill().id;
  },
  get name(): string {
    return getArduinoAsyncPolyfill().name;
  },
  get description(): string {
    return getArduinoAsyncPolyfill().description;
  },
  get domains(): PolyfillDomain[] {
    return getArduinoAsyncPolyfill().domains;
  },
  detect(program: any, context: any): any {
    return getArduinoAsyncPolyfill().detect(program, context);
  },
  generate(needs: any, context: any): any {
    return getArduinoAsyncPolyfill().generate(needs, context);
  },
};

export function findAwaitPoints(program: any): any {
  return getArduinoFramework().findAwaitPoints(program);
}
