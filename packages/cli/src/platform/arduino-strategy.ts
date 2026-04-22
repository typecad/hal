import { loadFrameworkPackage } from "../framework-package";

const FRAMEWORK_PACKAGE = "@typecode/framework-arduino";

function loadArduinoStrategyClass(): any {
  const pkg = loadFrameworkPackage(FRAMEWORK_PACKAGE, process.cwd());
  if (!pkg || !pkg.ArduinoStrategy) {
    throw new Error(
      `Unable to load ArduinoStrategy from ${FRAMEWORK_PACKAGE}. ` +
      `Install the framework package or configure a different framework package in your project.`,
    );
  }
  return pkg.ArduinoStrategy;
}

const ArduinoStrategy = new Proxy(function () {}, {
  construct(_target, args) {
    const StrategyClass = loadArduinoStrategyClass();
    return new StrategyClass(...args);
  },
  get(_target, property) {
    const StrategyClass = loadArduinoStrategyClass();
    return (StrategyClass as any)[property];
  },
}) as any;

export { ArduinoStrategy };
