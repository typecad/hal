// Vitest global setup — loads the default framework package so that all tests
// (including those that call transpileFile() or emitCpp() directly) can access
// framework functions without going through the test helper in setup.ts.

import { setLoadedFramework, registerPlatformStrategy } from "../packages/transpiler/src/testing";
import { ArduinoStrategy } from "../packages/framework-arduino/src";

const _arduinoStrategy = new ArduinoStrategy();
setLoadedFramework({ strategy: _arduinoStrategy });
registerPlatformStrategy(_arduinoStrategy);
