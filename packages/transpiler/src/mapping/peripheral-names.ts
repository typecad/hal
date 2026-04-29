/**
 * Peripheral name mapping utilities.
 *
 * Delegates peripheral identifier translation (e.g. I2C0 → Wire, SPI0 → SPI)
 * to the platform strategy. Framework packages implement `mapPeripheralIdentifier()`
 * to provide their target-specific naming conventions.
 */

import type { PlatformStrategy } from "../platform/platform-strategy";

// ---------------------------------------------------------------------------
// Peripheral name mapping
// ---------------------------------------------------------------------------

/**
 * Maps a TypeHAL peripheral identifier to its platform-specific C++ name.
 *
 * Delegates to `strategy.mapPeripheralIdentifier()` when available.
 * Returns `undefined` if the strategy does not recognize the name.
 */
export function mapPeripheralName(name: string, strategy?: PlatformStrategy): string | undefined {
  // Pass-through for Serial names (framework-agnostic convenience)
  if (/^Serial\d*$/.test(name)) {
    return name;
  }
  return strategy?.mapPeripheralIdentifier?.(name);
}

// ---------------------------------------------------------------------------
// Peripheral property rendering
// ---------------------------------------------------------------------------

/**
 * Renders a peripheral property access chain to a C++ expression string.
 *
 * Handles TypeScript stub properties on peripheral objects that don't exist
 * directly in C++. Returns `undefined` if the chain is not a recognized
 * peripheral property.
 */
export function renderPeripheralProperty(chain: string[], strategy?: PlatformStrategy): string | undefined {
  if (chain.length !== 2) return undefined;

  const [peripheral, property] = chain;
  const cppPeripheral = mapPeripheralName(peripheral, strategy);
  if (!cppPeripheral) return undefined;

  if (property === "available") {
    return `${cppPeripheral}.${property}`;
  }

  if (property === "isInitialized" || property === "isConnected") {
    return "true";
  }

  if (property === "busNumber" || property === "uartNumber") {
    return "0";
  }

  if (property === "speed") {
    return "100000";
  }

  return undefined;
}
