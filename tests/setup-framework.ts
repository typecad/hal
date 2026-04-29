// Vitest global setup — loads the default framework package so that all tests
// (including those that call transpileFile() or emitCpp() directly) can access
// framework functions without going through the test helper in setup.ts.

import { setLoadedFramework } from "../packages/transpiler/src/framework-registry";
import { registerPlatformStrategy } from "../packages/transpiler/src/platform/registry";
import { ArduinoStrategy, SYMBOL_KINDS } from "../packages/framework-arduino";

const _arduinoStrategy = new ArduinoStrategy();
setLoadedFramework({ strategy: _arduinoStrategy });
registerPlatformStrategy(_arduinoStrategy);

// Register symbol kinds using the same module path the transpiler resolves,
// so the shared state is the same module instance.
import { registerSymbolKinds } from "@typehal/core/shared";
registerSymbolKinds(SYMBOL_KINDS);
