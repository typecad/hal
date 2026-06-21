// ---------------------------------------------------------------------------
// Peripheral symbol helpers
//
// Shared detection/parsing for named bus instances like I2C0, SPI1, UART0,
// Serial, and Serial2.
// ---------------------------------------------------------------------------

type PeripheralReceiverKind = "i2c" | "spi" | "serial";

const I2C_INSTANCE_PATTERN = /^I2C(\d+)$/;
const SPI_INSTANCE_PATTERN = /^SPI(\d+)$/;
const UART_INSTANCE_PATTERN = /^UART(\d+)$/;
const SERIAL_INSTANCE_PATTERN = /^Serial(\d*)$/;

import { getCurrentBoardConstants } from "./build-ir-state.js";

export function inferPeripheralKindByName(name: string): PeripheralReceiverKind | undefined {
  const resolved = resolveCanonicalPeripheral(name);
  return resolved?.kind;
}

export function parsePeripheralInstance(name: string): { kind: PeripheralReceiverKind; index: number } | undefined {
  return resolveCanonicalPeripheral(name);
}

/**
 * Resolves a peripheral name (e.g. "UART0", "Serial", "Wire", "I2C1") 
 * to its canonical kind and index using the current board manifest aliases.
 */
function resolveCanonicalPeripheral(name: string): { kind: PeripheralReceiverKind; index: number } | undefined {
  const bc = getCurrentBoardConstants();

  // 1. Check if name is already canonical (UART0, I2C1, etc.)
  const canonicalMatch = name.match(/^(UART|I2C|SPI)(\d+)$/);
  if (canonicalMatch) {
    return {
      kind: canonicalMatch[1] === "UART" ? "serial" : canonicalMatch[1].toLowerCase() as any,
      index: parseInt(canonicalMatch[2], 10)
    };
  }

  // 2. Check if name is a platform alias (e.g. "Serial" -> UART0)
  if (bc) {
    for (const [key, value] of bc.entries()) {
      if (key.startsWith("peripherals.aliases.") && value === name) {
        const canonical = key.replace("peripherals.aliases.", "");
        const match = canonical.match(/^(UART|I2C|SPI)(\d+)$/);
        if (match) {
          return {
            kind: match[1] === "UART" ? "serial" : match[1].toLowerCase() as any,
            index: parseInt(match[2], 10)
          };
        }
      }
    }
  }

  // 3. Fallback to standard Arduino patterns (e.g. Serial2 -> UART2)
  const serialMatch = name.match(/^Serial(\d*)$/);
  if (serialMatch) {
    return {
      kind: "serial",
      index: serialMatch[1] === "" ? 0 : parseInt(serialMatch[1], 10)
    };
  }

  return undefined;
}