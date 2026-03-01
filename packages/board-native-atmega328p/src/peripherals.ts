// ---------------------------------------------------------------------------
// @typecode/board-native-atmega328p — Peripheral instances
//
// Stub objects representing the ATmega328P's built-in peripheral buses.
// These carry full type information at design-time so TypeScript prevents
// invalid usage. The transpiler replaces method calls with native AVR code.
// ---------------------------------------------------------------------------

import type { ISerialPort, UARTConfig, UARTStatus } from '@typecode/core';

// ---------------------------------------------------------------------------
// Serial — UART 0 (pins D0=RX, D1=TX)
// ---------------------------------------------------------------------------

/**
 * Native UART 0 using direct AVR register access.
 * 
 * Uses USART0 registers for communication:
 * - UDR0: Data register
 * - UCSR0A: Status register (RXC0, TXC0, UDRE0 flags)
 * - UCSR0B: Control register (RXEN0, TXEN0 enables)
 * - UCSR0C: Frame format (8N1)
 * - UBRR0H/L: Baud rate
 * 
 * @example
 * ```typescript
 * import { Serial } from '@typecode/board-native-atmega328p/peripherals';
 * 
 * Serial.initialize({ baudRate: 9600 });
 * Serial.println("Hello, World!");
 * 
 * if (Serial.available() > 0) {
 *   const data = Serial.read();
 * }
 * ```
 */
export const Serial: ISerialPort = {
  uartNumber: 0,
  baudRate: 9600,
  isInitialized: false,

  initialize(_config?: UARTConfig) { 
    /* native: _uart_init(baud) */ 
  },
  
  deinitialize() { 
    /* native: UCSR0B = 0 */ 
  },

  write(_data: Uint8Array): number { 
    return 0; 
  },
  
  writeString(_text: string): number { 
    return 0; 
  },
  
  writeLine(_text: string): number { 
    return 0; 
  },

  read(_length?: number): Uint8Array { 
    return new Uint8Array(0); 
  },
  
  readString(_length?: number): string { 
    return ''; 
  },
  
  readLine(_timeout?: number): string { 
    return ''; 
  },

  available(): number { 
    return 0; 
  },
  
  peek(): number { 
    return -1; 
  },
  
  flush() {
    /* native: wait for TX complete */
  },

  setBaudRate(_baud: number) {
    /* native: update UBRR0 */
  },
  
  getStatus(): UARTStatus {
    return {
      available: 0,
      writeAvailable: 1,
      overrunError: false,
      parityError: false,
      framingError: false,
      breakDetected: false
    };
  },
} as ISerialPort;

// ---------------------------------------------------------------------------
// Convenience exports for console.log polyfill
// ---------------------------------------------------------------------------

/**
 * Print a message to UART (for console.log polyfill).
 * @param msg The message to print
 */
export declare function console_log(msg: string): void;

/**
 * Print an error message to UART (for console.error polyfill).
 * Prefixes with "[ERROR] ".
 * @param msg The error message to print
 */
export declare function console_error(msg: string): void;

/**
 * Print a warning message to UART (for console.warn polyfill).
 * Prefixes with "[WARN] ".
 * @param msg The warning message to print
 */
export declare function console_warn(msg: string): void;
