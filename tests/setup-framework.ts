// Vitest global setup — loads the default framework package so that all tests
// (including those that call transpileFile() or emitCpp() directly) can access
// framework functions without going through the test helper in setup.ts.
//
// Legacy framework-arduino removed: the Zephyr strategy is the default loaded
// framework for the remaining suites.

import { setLoadedFramework, registerPlatformStrategy } from "../packages/cuttlefish/src/testing";
import { ZephyrStrategy } from "../packages/framework-zephyr/src/strategy";
import { setUIHook } from "../packages/cuttlefish/src/ui-hook";
import { registerTranspilerUI } from "../packages/ui/src/engine-index";
import { setSafetyHook } from "../packages/cuttlefish/src/safety-hook";
import { registerSafetyEngine } from "../packages/cuttlefish/src/safety/engine";

const _zephyrStrategy = new ZephyrStrategy();
setLoadedFramework({ strategy: _zephyrStrategy });
registerPlatformStrategy(_zephyrStrategy);

// Register the UI engine hook so tests that call resolveColorInternal,
// lowerOnMount, etc. directly (without going through transpileFile) work.
setUIHook(registerTranspilerUI());

// Register the safety engine hook so tests that exercise safe.read /
// safe.pinMode work without going through the full dynamic-import bridge.
setSafetyHook(registerSafetyEngine());
