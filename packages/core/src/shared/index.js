"use strict";
// ---------------------------------------------------------------------------
// Shared types barrel export
//
// Re-exports all shared types for use by CLI and framework packages.
// ---------------------------------------------------------------------------
Object.defineProperty(exports, "__esModule", { value: true });
exports.toArchitectureFromFqbn = exports.collectCppFiles = exports.parseCompileErrors = exports.getStdLibSupport = exports.STDLIB_SUPPORT = exports.DEFAULT_POLYFILL_CONFIG = exports.inferKindByName = void 0;
var typecode_symbols_1 = require("./typecode-symbols");
Object.defineProperty(exports, "inferKindByName", { enumerable: true, get: function () { return typecode_symbols_1.inferKindByName; } });
var polyfill_types_1 = require("./polyfill-types");
Object.defineProperty(exports, "DEFAULT_POLYFILL_CONFIG", { enumerable: true, get: function () { return polyfill_types_1.DEFAULT_POLYFILL_CONFIG; } });
Object.defineProperty(exports, "STDLIB_SUPPORT", { enumerable: true, get: function () { return polyfill_types_1.STDLIB_SUPPORT; } });
Object.defineProperty(exports, "getStdLibSupport", { enumerable: true, get: function () { return polyfill_types_1.getStdLibSupport; } });
var toolchain_types_1 = require("./toolchain-types");
Object.defineProperty(exports, "parseCompileErrors", { enumerable: true, get: function () { return toolchain_types_1.parseCompileErrors; } });
Object.defineProperty(exports, "collectCppFiles", { enumerable: true, get: function () { return toolchain_types_1.collectCppFiles; } });
Object.defineProperty(exports, "toArchitectureFromFqbn", { enumerable: true, get: function () { return toolchain_types_1.toArchitectureFromFqbn; } });
//# sourceMappingURL=index.js.map