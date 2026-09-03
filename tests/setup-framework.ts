// Vitest global setup — loads the default framework package so that all tests
// (including those that call transpileFile() or emitCpp() directly) can access
// framework functions without going through the test helper in setup.ts.
//
// Legacy framework-arduino removed: the Zephyr strategy is the default loaded
// framework for the remaining suites.

import { fileURLToPath } from 'node:url';
import { setLoadedFramework, registerPlatformStrategy } from "../packages/cuttlefish/src/testing";
import { ZephyrStrategy } from "../packages/framework-zephyr/src/strategy";
import { setUIHook } from "../packages/cuttlefish/src/ui-hook";
import { registerTranspilerUI } from "../packages/ui/src/engine-index";
import { setSafetyHook } from "../packages/cuttlefish/src/safety-hook";
import { registerSafetyEngine } from "../packages/cuttlefish/src/safety/engine";

const _zephyrStrategy = new ZephyrStrategy();
setLoadedFramework({ strategy: _zephyrStrategy });
registerPlatformStrategy(_zephyrStrategy);

// Pin board catalog lookups to the checked-in fixture overlay — there is no
// compiled-in pack, and a real ~/zephyrproject overlay on a dev machine must
// never make suite results depend on the machine's Zephyr tree. The fixture
// is generated from the pinned tree filtered to the boards the suites
// reference (see tests/fixtures/board-catalog.overlay.json). Overlay tests
// override CUTTLEFISH_BOARD_CATALOG themselves and reset the loader caches.
process.env.CUTTLEFISH_BOARD_CATALOG = process.env.CUTTLEFISH_BOARD_CATALOG
  ?? fileURLToPath(new URL('./fixtures/board-catalog.overlay.json', import.meta.url));

// Register the UI engine hook so tests that call resolveColorInternal,
// lowerOnMount, etc. directly (without going through transpileFile) work.
setUIHook(registerTranspilerUI());

// Register the safety engine hook so tests that exercise safe.read /
// safe.pinMode work without going through the full dynamic-import bridge.
setSafetyHook(registerSafetyEngine());
