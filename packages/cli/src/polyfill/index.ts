// Polyfill System - Main Entry Point
// Provides runtime polyfills for TypeScript features in C++

export * from "./types";
export * from "./registry";
export * from "./emitter";

// Template-based polyfill system
export * from "./template-types";
export * from "./generator";
export { STATIC_ARRAY_TEMPLATE, STATIC_STRING_TEMPLATE, CONSOLE_TEMPLATE } from "./templates";

// Re-export polyfill definitions for direct access
export { consolePolyfill } from "./polyfills/console";
export { arduinoAsyncPolyfill } from "./polyfills/async-arduino";
export { arrayMethodsPolyfill } from "./polyfills/array-methods";
export { stringMethodsPolyfill } from "./polyfills/string-methods";

// Plugin system for extensibility
export {
  // Types
  type PolyfillPlugin,
  type PluginContext,
  type PluginLogger,
  type PluginLoadResult,
  type PluginLoaderOptions,
  // Functions
  loadPolyfillPlugin,
  createSimplePlugin,
  // Classes
  PluginManager,
  // Example
  exampleCustomPlugin,
} from "./plugin";
