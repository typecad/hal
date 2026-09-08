// ---------------------------------------------------------------------------
// @typecad/hal/sim — Serial port simulation
//
// Implements the ISerialPort contract (mirroring the HAL SerialPort —
// packages/hal/src/uart.ts). The HAL is the source of truth: this class
// exposes only the methods the HAL does, plus test-only helpers (injectRx,
// flushTx, peekTx, peekTxAsString, reset) that are not part of the contract.
// ---------------------------------------------------------------------------

import type { ISerialPort } from '../contracts.js';

export class SimSerialPort implements ISerialPort {
  private _rxBuffer: number[] = [];
  private _txBuffer: number[] = [];
  private readonly _rxBufferSize: number;
  private readonly _txBufferSize: number;

  constructor(rxBufferSize: number = 256, txBufferSize: number = 256) {
    this._rxBufferSize = rxBufferSize;
    this._txBufferSize = txBufferSize;
  }

  // --- IUARTBus methods ---

  begin(_baud: number = 9600): this {
    return this;
  }

  end(): void {
    // In simulation, ending the port is a no-op (buffers are not destroyed).
  }

  read(): number {
    if (this._rxBuffer.length === 0) return -1;
    return this._rxBuffer.shift()!;
  }

  peek(): number {
    if (this._rxBuffer.length === 0) return -1;
    return this._rxBuffer[0];
  }

  readLine(): string {
    const idx = this._rxBuffer.findIndex(b => b === 0x0A);
    if (idx === -1) return '';
    const lineBytes = this._rxBuffer.splice(0, idx + 1);
    return new TextDecoder().decode(new Uint8Array(lineBytes)).trimEnd();
  }

  available(): number {
    return this._rxBuffer.length;
  }

  write(data: number | Uint8Array | string): void {
    const bytes = typeof data === 'number'
      ? [data & 0xFF]
      : typeof data === 'string'
        ? this._encodeString(data)
        : Array.from(data);
    this._pushTxBytes(bytes);
  }

  flush(): void {
    // In simulation, data is "sent" immediately when written to the TX buffer.
  }

  // --- ISerialPort methods ---

  print(...args: unknown[]): void {
    const text = args.map(a => String(a)).join('');
    this.write(text);
  }

  println(...args: unknown[]): void {
    const text = args.map(a => String(a)).join('');
    this.write(text + '\r\n');
  }

  printf(format: string, ...args: unknown[]): void {
    const text = this._formatString(format, args);
    this.write(text);
  }

  async waitForConnection(_timeout?: number): Promise<void> {
    // In simulation, just resolve immediately
  }

  // --- Simulation helpers ---

  /**
   * Inject bytes into the RX buffer (simulating received data).
   */
  injectRx(data: Uint8Array | number[] | string): void {
    const bytes = typeof data === 'string'
      ? this._encodeString(data)
      : Array.isArray(data)
        ? data
        : Array.from(data);

    for (const b of bytes) {
      if (this._rxBuffer.length >= this._rxBufferSize) {
        break;
      }
      this._rxBuffer.push(b & 0xFF);
    }
  }

  /**
   * Get all bytes written to the TX buffer since the last call.
   * Clears the TX buffer.
   */
  flushTx(): number[] {
    const result = this._txBuffer.slice();
    this._txBuffer = [];
    return result;
  }

  /**
   * Get the TX buffer contents without clearing.
   */
  peekTx(): readonly number[] {
    return this._txBuffer;
  }

  /**
   * Get the TX buffer contents as a string.
   */
  peekTxAsString(): string {
    return new TextDecoder().decode(new Uint8Array(this._txBuffer));
  }

  /**
   * Reset all buffers and state.
   */
  reset(): void {
    this._rxBuffer = [];
    this._txBuffer = [];
  }

  // --- Private helpers ---

  private _pushTxBytes(bytes: number[]): number {
    let written = 0;
    for (const b of bytes) {
      if (this._txBuffer.length >= this._txBufferSize) break;
      this._txBuffer.push(b & 0xFF);
      written++;
    }
    return written;
  }

  private _encodeString(text: string): number[] {
    return Array.from(new TextEncoder().encode(text));
  }

  private _formatString(fmt: string, args: unknown[]): string {
    let result = '';
    let argIdx = 0;
    for (let i = 0; i < fmt.length; i++) {
      if (fmt[i] === '{' && fmt[i + 1] === '}') {
        result += String(args[argIdx++] ?? '');
        i++;
      } else if (fmt[i] === '%' && i + 1 < fmt.length) {
        const spec = fmt[i + 1];
        if (spec === 'd' || spec === 'i') {
          result += String(Number(args[argIdx++]) || 0);
          i++;
        } else if (spec === 's') {
          result += String(args[argIdx++] ?? '');
          i++;
        } else if (spec === 'f') {
          result += String(Number(args[argIdx++]) || 0.0);
          i++;
        } else if (spec === '%') {
          result += '%';
          i++;
        } else {
          result += fmt[i];
        }
      } else {
        result += fmt[i];
      }
    }
    return result;
  }
}
