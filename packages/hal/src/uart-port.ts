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

export class UART {
  private readonly _port: string;
  private readonly _baud: number;
  private readonly _rxBufferBytes: number;

  /** Construct a port handle. `port` is the UART instance (UART0, UART1, …);
   *  `baud` applies once at first use (default 115200, 8N1);
   *  `rxBufferBytes` sizes the receive ring (default 64). */
  constructor(port: string, opts?: { baud?: number; rxBufferBytes?: number }) {
    this._port = port;
    this._baud = opts?.baud ?? 115200;
    this._rxBufferBytes = opts?.rxBufferBytes ?? 64;
  }

  /** Write text, a number, or a boolean (uart_poll_out per byte). No newline
   *  appended. Numbers format as decimal; booleans print as 1/0. */
  write(data: SerialValue): void {
    uartPollWrite(this._port, this._baud, data);
  }

  /** Write a value followed by a newline. */
  writeLine(data: SerialValue): void {
    uartPollWrite(this._port, this._baud, data);
    uartPollWrite(this._port, this._baud, "\n");
  }

  /** Bytes waiting in the receive ring. Arms the RX interrupt on first
   *  use (uart_irq_callback_user_data_set + uart_irq_rx_enable — the
   *  callback drains the FIFO into the ring). */
  available(): number {
    return uartRxAvailable(this._port, this._rxBufferBytes);
  }

  /** The oldest received byte WITHOUT consuming it; -1 when empty. */
  peek(): number {
    return uartRxPeek(this._port, this._rxBufferBytes);
  }

  /** Pop the oldest received byte; -1 when the ring is empty. */
  read(): number {
    return uartRxRead(this._port, this._rxBufferBytes);
  }
}
