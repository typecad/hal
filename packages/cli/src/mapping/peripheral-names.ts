/**
 * Peripheral name mapping utilities.
 *
 * Single source of truth for TypeScript peripheral identifier → C++ name
 * translation (I2C0 → Wire, SPI0 → SPI, UART0 → Serial, etc.).
 *
 * This module centralizes logic that was previously duplicated in
 * cpp-emitter.ts, expression-renderer.ts, and statement-renderer.ts.
 */

// ---------------------------------------------------------------------------
// Peripheral name mapping
// ---------------------------------------------------------------------------

/**
 * Maps a TypeCode peripheral identifier to its Arduino C++ name.
 *
 * Returns `undefined` if the name is not a recognized peripheral identifier.
 *
 * @example
 * mapPeripheralName("I2C0")  // → "Wire"
 * mapPeripheralName("I2C1")  // → "Wire1"
 * mapPeripheralName("SPI0")  // → "SPI"
 * mapPeripheralName("UART0") // → "Serial"
 * mapPeripheralName("UART1") // → "Serial1"
 * mapPeripheralName("Serial") // → "Serial"
 * mapPeripheralName("D13")   // → undefined
 */
export function mapPeripheralName(name: string): string | undefined {
  // I2C buses: I2C0 -> Wire, I2C1 -> Wire1, I2C2 -> Wire2
  if (/^I2C\d+$/.test(name)) {
    const num = name.slice(3);
    return num === '0' ? 'Wire' : `Wire${num}`;
  }
  // SPI buses: SPI0 -> SPI, SPI1 -> SPI1, SPI2 -> SPI2
  if (/^SPI\d+$/.test(name)) {
    const num = name.slice(3);
    return num === '0' ? 'SPI' : `SPI${num}`;
  }
  // UART ports: UART0 -> Serial, UART1 -> Serial1, UART2 -> Serial2
  if (/^UART\d+$/.test(name)) {
    const num = name.slice(4);
    return num === '0' ? 'Serial' : `Serial${num}`;
  }
  // Serial ports: Serial -> Serial, Serial1 -> Serial1 (pass-through)
  if (/^Serial\d*$/.test(name)) {
    return name;
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Peripheral property rendering
// ---------------------------------------------------------------------------

/**
 * Renders a peripheral property access chain to a C++ expression string.
 *
 * Handles TypeScript stub properties on peripheral objects (I2C0, SPI0, UART0)
 * that don't exist directly in C++. Returns `undefined` if the chain is not
 * a recognized peripheral property.
 *
 * @param chain - Property access chain, e.g. `["I2C0", "isInitialized"]`
 * @returns C++ expression string or `undefined`
 */
export function renderPeripheralProperty(chain: string[]): string | undefined {
  if (chain.length !== 2) return undefined;

  const [peripheral, property] = chain;
  const cppPeripheral = mapPeripheralName(peripheral);
  if (!cppPeripheral) return undefined;

  // Properties that exist directly on the C++ objects
  if (property === "available") {
    return `${cppPeripheral}.${property}`;
  }

  // TypeScript compile-time stubs — return true (peripherals are initialized in setup())
  if (property === "isInitialized" || property === "isConnected") {
    return "true";
  }

  // Numeric constants — bus/uart index is always 0 for the main peripheral
  if (property === "busNumber" || property === "uartNumber") {
    return "0";
  }

  // Speed constant — return standard 100kHz as a default
  if (property === "speed") {
    return "100000";
  }

  return undefined;
}
