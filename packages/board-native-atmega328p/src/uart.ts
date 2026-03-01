// ---------------------------------------------------------------------------
// @typecode/board-native-atmega328p — Native UART/Serial functions
//
// Direct AVR register access for UART communication on ATmega328P.
// Uses USART0 registers: UDR0, UCSR0A, UCSR0B, UCSR0C, UBRR0H, UBRR0L.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// UART Initialization
// ---------------------------------------------------------------------------

/**
 * Initialize UART with specified baud rate.
 * Configures 8N1 (8 data bits, no parity, 1 stop bit).
 * @param baudRate Baud rate (e.g., 9600, 115200)
 */
export declare function uart_init(baudRate: number): void;

// ---------------------------------------------------------------------------
// Status Functions
// ---------------------------------------------------------------------------

/**
 * Check if data is available to read.
 * @returns Number of bytes available (0 or 1 for polling mode)
 */
export declare function uart_available(): number;

/**
 * Check if transmit buffer is empty and ready for new data.
 * @returns true if ready to transmit
 */
export declare function uart_canWrite(): boolean;

// ---------------------------------------------------------------------------
// Read Functions
// ---------------------------------------------------------------------------

/**
 * Read a single byte from UART (blocking).
 * Waits until data is available.
 * @returns The received byte (0-255)
 */
export declare function uart_read(): number;

/**
 * Read a single byte from UART (non-blocking).
 * @returns The received byte, or -1 if no data available
 */
export declare function uart_readAsync(): number;

/**
 * Peek at the next byte without removing it from buffer.
 * @returns The next byte, or -1 if no data available
 */
export declare function uart_peek(): number;

// ---------------------------------------------------------------------------
// Write Functions
// ---------------------------------------------------------------------------

/**
 * Write a single byte to UART (blocking).
 * Waits until transmit buffer is ready.
 * @param byte The byte to write (0-255)
 */
export declare function uart_write(byte: number): void;

/**
 * Write a buffer of bytes to UART.
 * @param data The bytes to write
 * @returns Number of bytes written
 */
export declare function uart_writeBuffer(data: Uint8Array): number;

// ---------------------------------------------------------------------------
// Print Functions - Strings
// ---------------------------------------------------------------------------

/**
 * Print a null-terminated string (from program memory).
 * @param text The string to print
 */
export declare function uart_print(text: string): void;

/**
 * Print a string followed by CRLF newline.
 * @param text The string to print
 */
export declare function uart_println(text: string): void;

/**
 * Print a single character.
 * @param c The character to print
 */
export declare function uart_printChar(c: string): void;

// ---------------------------------------------------------------------------
// Print Functions - Numbers
// ---------------------------------------------------------------------------

/**
 * Print a signed integer in decimal format.
 * @param value The number to print
 */
export declare function uart_printInt(value: number): void;

/**
 * Print a signed integer with newline.
 * @param value The number to print
 */
export declare function uart_printlnInt(value: number): void;

/**
 * Print an unsigned integer in decimal format.
 * @param value The number to print
 */
export declare function uart_printUInt(value: number): void;

/**
 * Print a long integer in decimal format.
 * @param value The number to print
 */
export declare function uart_printLong(value: number): void;

/**
 * Print a long integer with newline.
 * @param value The number to print
 */
export declare function uart_printlnLong(value: number): void;

/**
 * Print an unsigned long integer in decimal format.
 * @param value The number to print
 */
export declare function uart_printULong(value: number): void;

/**
 * Print a floating-point number with specified decimal places.
 * Note: Float printing is expensive on AVR - use sparingly.
 * @param value The number to print
 * @param decimals Number of decimal places (default 2)
 */
export declare function uart_printFloat(value: number, decimals?: number): void;

/**
 * Print a floating-point number with newline.
 * @param value The number to print
 * @param decimals Number of decimal places (default 2)
 */
export declare function uart_printlnFloat(value: number, decimals?: number): void;

/**
 * Print a number in hexadecimal format.
 * @param value The number to print
 * @param digits Minimum number of digits (padded with zeros)
 */
export declare function uart_printHex(value: number, digits?: number): void;

/**
 * Print a number in binary format.
 * @param value The number to print
 * @param digits Minimum number of digits (padded with zeros)
 */
export declare function uart_printBin(value: number, digits?: number): void;

// ---------------------------------------------------------------------------
// Line Reading
// ---------------------------------------------------------------------------

/**
 * Read a line of text until newline or buffer full.
 * @param maxLength Maximum bytes to read
 * @param timeout_ms Timeout in milliseconds (0 = no timeout)
 * @returns The line read (without newline), or empty string on timeout
 */
export declare function uart_readLine(maxLength: number, timeout_ms?: number): string;

// ---------------------------------------------------------------------------
// Flush Functions
// ---------------------------------------------------------------------------

/**
 * Wait for all outgoing data to be transmitted.
 */
export declare function uart_flush(): void;

/**
 * Discard all incoming data in receive buffer.
 */
export declare function uart_discardInput(): void;
