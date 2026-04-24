// ---------------------------------------------------------------------------
// Platform strategy registry
//
// Maps TargetProfile strings to PlatformStrategy implementations.
// Framework packages call `registerPlatformStrategy()` to plug in custom
// strategies at import time.
// ---------------------------------------------------------------------------

import type { PlatformStrategy } from "./platform-strategy";
import { GenericStrategy } from "./generic-strategy";
import { getFrameworkApi, hasFrameworkApi } from "../framework-api";

// Store references to strategy instances for cache management
const _genericStrategy = new GenericStrategy();
let _arduinoStrategy: PlatformStrategy | undefined;
let _arduinoStrategyLoaded = false;

const _registry = new Map<string, PlatformStrategy>([
  ["generic", _genericStrategy],
]);

function ensureArduinoStrategy(): void {
  if (_arduinoStrategyLoaded) return;
  _arduinoStrategyLoaded = true;

  try {
    if (!hasFrameworkApi()) return;
    const api = getFrameworkApi();
    const strategy = new api.FrameworkStrategy();
    _arduinoStrategy = strategy;
    _registry.set("arduino", strategy);
  } catch {
    // Arduino framework package not installed or unavailable.
    // Fallback to generic strategy for generic targets.
  }
}

/**
 * Register a custom platform strategy.  Board packages call this from
 * their entry point to override the default strategy for a target.
 *
 * @example
 * // In @typecode/board-avr-atmega328p
 * import { registerPlatformStrategy } from "@typecode/cli/platform/registry";
 * registerPlatformStrategy(new Atmega328pStrategy());
 */
export function registerPlatformStrategy(strategy: PlatformStrategy): void {
  _registry.set(strategy.id, strategy);
}

/**
 * Resolve a PlatformStrategy for the given target profile.
 * Falls back to the "generic" strategy if no match is found.
 */
export function resolveStrategy(target: string): PlatformStrategy {
  if (target === "arduino") {
    ensureArduinoStrategy();
  }
  return _registry.get(target) ?? _registry.get("generic")!;
}

/**
 * Clear the Arduino profile cache.
 * Should be called between transpilations to ensure fresh profile resolution.
 */
export function clearArduinoProfileCache(): void {
  if (_arduinoStrategy && typeof (_arduinoStrategy as any).clearProfileCache === "function") {
    (_arduinoStrategy as any).clearProfileCache();
  }
}
