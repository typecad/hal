// ---------------------------------------------------------------------------
// Platform strategy registry
//
// Maps target profile strings to PlatformStrategy implementations.
// Framework packages call `registerPlatformStrategy()` to plug in custom
// strategies at import time.
// ---------------------------------------------------------------------------

import type { PlatformStrategy } from "../api/shared/index.js";
import { GenericStrategy } from "./generic-strategy.js";

const _genericStrategy = new GenericStrategy();

const _registry = new Map<string, PlatformStrategy>([
  ["generic", _genericStrategy],
]);

/**
 * Register a custom platform strategy.  Framework packages call this from
 * their entry point to override the default strategy for a target.
 *
 * @example
 * // In @typecad/framework-zephyr
 * import { registerPlatformStrategy } from "@typecad/cuttlefish/platform/registry";
 * registerPlatformStrategy(new ZephyrStrategy());
 */
export function registerPlatformStrategy(strategy: PlatformStrategy): void {
  _registry.set(strategy.id, strategy);
}

/**
 * Resolve a PlatformStrategy for the given target profile.
 * Falls back to the "generic" strategy if no match is found.
 */
export function resolveStrategy(target: string): PlatformStrategy {
  return _registry.get(target) ?? _registry.get("generic")!;
}

/**
 * Clear profile caches on all registered strategies.
 * Should be called between transpilations to ensure fresh profile resolution.
 */
export function clearAllProfileCaches(): void {
  for (const strategy of _registry.values()) {
    if (typeof (strategy as any).clearProfileCache === "function") {
      (strategy as any).clearProfileCache();
    }
  }
}
