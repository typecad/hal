// ---------------------------------------------------------------------------
// @typecad/framework-arduino — UART/Serial Arduino-compatible API interface
//
// Arduino Serial-compatible methods for UART communication.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Arduino Serial-compatible Interface
// ---------------------------------------------------------------------------

/**
 * Arduino Serial-compatible UART interface.
 *
 * Usage:
 * ```typescript
 * import { UART0 } from '@typecad/framework-arduino/arduino';
 *
 * UART0.begin(9600);
 * UART0.println("Hello, World!");
 *
 * if (UART0.available() > 0) {
 *   const data = UART0.read();
 *   UART0.write(data);
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
