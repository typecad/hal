// ---------------------------------------------------------------------------
// Platform strategy registry
//
// Maps TargetProfile strings to PlatformStrategy implementations.
// Board packages can call `registerPlatformStrategy()` to plug in custom
// strategies at import time.
// ---------------------------------------------------------------------------

import type { PlatformStrategy } from "./platform-strategy";
import { ArduinoStrategy } from "./arduino-strategy";
import { GenericStrategy } from "./generic-strategy";

const _registry = new Map<string, PlatformStrategy>([
  ["arduino", new ArduinoStrategy()],
  ["generic", new GenericStrategy()],
]);

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
  return _registry.get(target) ?? _registry.get("generic")!;
}
