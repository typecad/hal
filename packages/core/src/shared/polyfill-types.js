"use strict";
// ---------------------------------------------------------------------------
// Polyfill types
//
// Types for runtime polyfill generation.
// ---------------------------------------------------------------------------
Object.defineProperty(exports, "__esModule", { value: true });
exports.STDLIB_SUPPORT = exports.DEFAULT_POLYFILL_CONFIG = void 0;
exports.getStdLibSupport = getStdLibSupport;
exports.DEFAULT_POLYFILL_CONFIG = {
    console: {
        enabled: true,
        target: "auto",
        useFlashStrings: true,
        baudRate: 9600,
        autoInjectSerialBegin: true,
    },
    async: {
        enabled: true,
        mode: "state-machine",
        scheduler: false,
    },
    arrays: {
        enabled: true,
        prefer: "auto",
        staticMaxSize: 32,
        microMaxSize: 16,
    },
    strings: {
        enabled: true,
        prefer: "auto",
        staticMaxLen: 64,
    },
    exceptions: {
        enabled: "auto",
        fallback: "error_code",
    },
};
exports.STDLIB_SUPPORT = {
    avr: {
        hasVector: false,
        hasString: false,
        hasIostream: false,
        hasExceptions: false,
        hasRTTI: false,
        recommendedArrayImpl: "static_array",
        recommendedStringImpl: "static_string",
    },
    esp32: {
        hasVector: true,
        hasString: true,
        hasIostream: true,
        hasExceptions: true,
        hasRTTI: true,
        recommendedArrayImpl: "std_vector",
        recommendedStringImpl: "std_string",
    },
    esp8266: {
        hasVector: true,
        hasString: true,
        hasIostream: true,
        hasExceptions: true,
        hasRTTI: true,
        recommendedArrayImpl: "std_vector",
        recommendedStringImpl: "std_string",
    },
    rp2040: {
        hasVector: true,
        hasString: true,
        hasIostream: true,
        hasExceptions: true,
        hasRTTI: true,
        recommendedArrayImpl: "std_vector",
        recommendedStringImpl: "std_string",
    },
    samd: {
        hasVector: true,
        hasString: true,
        hasIostream: true,
        hasExceptions: true,
        hasRTTI: true,
        recommendedArrayImpl: "std_vector",
        recommendedStringImpl: "std_string",
    },
    megaavr: {
        hasVector: false,
        hasString: false,
        hasIostream: false,
        hasExceptions: false,
        hasRTTI: false,
        recommendedArrayImpl: "static_array",
        recommendedStringImpl: "static_string",
    },
    default: {
        hasVector: true,
        hasString: true,
        hasIostream: true,
        hasExceptions: true,
        hasRTTI: true,
        recommendedArrayImpl: "std_vector",
        recommendedStringImpl: "std_string",
    },
};
function getStdLibSupport(architecture) {
    if (!architecture)
        return exports.STDLIB_SUPPORT.default;
    return exports.STDLIB_SUPPORT[architecture.toLowerCase()] ?? exports.STDLIB_SUPPORT.default;
}
//# sourceMappingURL=polyfill-types.js.map