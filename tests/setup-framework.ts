// Vitest global setup — loads the default framework package so that all tests
// (including those that call transpileFile() or emitCpp() directly) can access
// framework functions without going through the test helper in setup.ts.

import { setFrameworkApi } from "../packages/cli/src/framework-api";

// eslint-disable-next-line @typescript-eslint/no-var-requires
setFrameworkApi(require("../packages/framework-arduino"));
