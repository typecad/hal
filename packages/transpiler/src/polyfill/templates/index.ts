/**
 * Polyfill templates barrel export.
 * Importing this module registers all templates.
 */

// Import all templates to register them
import "./static-array-template";
import "./static-string-template";
import "./console-template";

// Re-export for convenience
export { STATIC_ARRAY_TEMPLATE } from "./static-array-template";
export { STATIC_STRING_TEMPLATE } from "./static-string-template";
export { CONSOLE_TEMPLATE } from "./console-template";