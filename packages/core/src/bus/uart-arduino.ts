// ---------------------------------------------------------------------------
// @typehal/core — UART/Serial Arduino-compatible API interface
//
// This interface provides Arduino Serial-compatible methods for UART communication.
// Import from '@typehal/core/arduino' or '@typehal/board-arduino-uno/arduino'
// to use this API style.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Arduino Serial-compatible Interface
// ---------------------------------------------------------------------------

/**
 * Arduino Serial-compatible UART interface.
 * 
 * Usage:
 * ```typescript
 * import { Serial } from '@typehal/board-arduino-uno/arduino';
 * 
 * Serial.begin(9600);
 * Serial.println("Hello, World!");
 * 
 * if (Serial.available() > 0) {
 *   const data = Serial.read();
 *   Serial.write(data);
 * }
 * ```
 */
export interface ISerialArduino {
  readonly uartNumber: number;
  readonly baudRate: number;
  readonly isInitialized: boolean;

  // --- Initialization ---
  /** Initialize with baud rate. */
  begin(baud: number): void;
  /** Deinitialize the UART. */
  end(): void;

  // --- Read API ---
  /** Number of bytes available to read. */
  available(): number;
  /** Peek at next byte without consuming. Returns -1 if no data. */
  peek(): number;
  /** Read a single byte. Returns -1 if no data available. */
  read(): number;
  /** Write a single byte or buffer. Returns number of bytes written. */
  write(data: number | Uint8Array | string): number;

  // --- Buffer control ---
  /** Wait for transmission to complete. */
  flush(): void;

  // --- Print helpers ---
  /** Print values without newline. */
  print(...args: unknown[]): void;
  /** Print values with newline. */
  println(...args: unknown[]): void;
  /** Printf-style formatted print. */
  printf(format: string, ...args: unknown[]): void;
}