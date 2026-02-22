// Polyfill System - Main Entry Point
// Provides runtime polyfills for TypeScript features in C++

export * from "./types";
export * from "./registry";
export * from "./emitter";

// Re-export polyfill definitions for direct access
export { consolePolyfill } from "./polyfills/console";
export { arduinoAsyncPolyfill } from "./polyfills/async-arduino";
export { arrayMethodsPolyfill } from "./polyfills/array-methods";
export { stringMethodsPolyfill } from "./polyfills/string-methods";