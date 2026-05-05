// Vitest global setup — loads the default framework package so that all tests
// (including those that call transpileFile() or emitCpp() directly) can access
// framework functions without going through the test helper in setup.ts.

import { setLoadedFramework, registerPlatformStrategy } from "@typehal/transpiler/testing";
import { ArduinoStrategy } from "../packages/framework-arduino";

const _arduinoStrategy = new ArduinoStrategy();
setLoadedFramework({ strategy: _arduinoStrategy });
registerPlatformStrategy(_arduinoStrategy);
