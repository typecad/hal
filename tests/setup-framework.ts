// Vitest global setup — loads the default framework package so that all tests
// (including those that call transpileFile() or emitCpp() directly) can access
// framework functions without going through the test helper in setup.ts.

import { setLoadedFramework } from "../packages/transpiler/src/framework-registry";
import { registerPlatformStrategy } from "../packages/transpiler/src/platform/registry";
import { ArduinoStrategy } from "../packages/framework-arduino";

const _arduinoStrategy = new ArduinoStrategy();
setLoadedFramework({ strategy: _arduinoStrategy });
registerPlatformStrategy(_arduinoStrategy);
