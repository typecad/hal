// ---------------------------------------------------------------------------
// UART — the thin Zephyr-shaped serial port
//
// TX is poll-based (uart_poll_out — synchronous, fine for writes); RX is
// INTERRUPT-backed: the first receive call arms the driver's IRQ callback,
// which drains the FIFO into a construction-sized ring buffer. That makes
// the honest versions of the calls the poll API couldn't support:
//   available() — bytes waiting in the ring (the poll driver cannot report
//                 this without draining the byte you want next)
//   peek()      — the oldest byte WITHOUT consuming it
//   read()      — pop the oldest byte, or -1 when the ring is empty
//
// Construction: `new UART('UART0', { baud: 9600, rxBufferBytes: 128 })` —
// the ring size (default 64) is a construction fact that sizes the shim's
// static buffer; bytes arriving with a full ring are dropped (the embedded
// honest answer — no unbounded buffering).
// ----------------------------------------------------------------------------

import { uartPollWrite, uartRxAvailable, uartRxPeek, uartRxRead } from './emit.js';
import type { SerialValue } from './types.js';

/**
 * A serial port: `new UART('UART0', { baud: 115200, rxBufferBytes: 128 })`.
 * Writes are synchronous; incoming bytes land in a receive buffer —
 * `available()` counts them, `read()` pops the oldest byte (-1 when
 * empty), `peek()` looks without consuming. Bytes arriving while the
 * buffer is full are dropped, so size it for your worst burst.
 */
export class UART {
  private readonly _port: string;
  private readonly _baud: number;
  private readonly _rxBufferBytes: number;

  /** Construct a port handle. `port` is the UART instance (UART0, UART1, …);
   *  `baud` applies at startup (default 115200, 8N1); `rxBufferBytes`
   *  sizes the receive buffer (default 64). */
  constructor(port: string, opts?: { baud?: number; rxBufferBytes?: number }) {
    this._port = port;
    this._baud = opts?.baud ?? 115200;
    this._rxBufferBytes = opts?.rxBufferBytes ?? 64;
  }

  /** Write text, a number, or a boolean. Numbers format as decimal;
   *  booleans print as 1/0. No newline appended. */
  write(data: SerialValue): void {
    uartPollWrite(this._port, this._baud, data);
  }

  /** Write a value followed by a newline. */
  writeLine(data: SerialValue): void {
    uartPollWrite(this._port, this._baud, data);
    uartPollWrite(this._port, this._baud, "\n");
  }

  /** Bytes waiting in the receive buffer. Receiving starts at the first
   *  receive call — call this early in setup if input can arrive right
   *  away. */
  available(): number {
    return uartRxAvailable(this._port, this._rxBufferBytes);
  }

  /** The oldest received byte without consuming it; -1 when empty. */
  peek(): number {
    return uartRxPeek(this._port, this._rxBufferBytes);
  }

  /** Pop the oldest received byte; -1 when the buffer is empty. */
  read(): number {
    return uartRxRead(this._port, this._rxBufferBytes);
  }
}
