// ---------------------------------------------------------------------------
// @typecode/simulator — Serial port simulation
// ---------------------------------------------------------------------------

import {
  UARTStatus,
} from '@typecode/core';
import type {
  ISerialPort,
  UARTStatusInfo,
} from '@typecode/core';

// ---------------------------------------------------------------------------
// SimSerialPort
// ---------------------------------------------------------------------------

/**
 * Simulated serial port for testing UART communication.
 *
 * Tests can inject bytes into the RX buffer and inspect the TX buffer
 * to verify that sketch code sends the expected data.
 */
export class SimSerialPort implements ISerialPort {
  readonly uartNumber: number;
  baudRate: number = 0;
  isEnabled: boolean = false;
  debugOnError: boolean = false;

  private _rxBuffer: number[] = [];
  private _txBuffer: number[] = [];
  private _rxBufferSize: number;
  private _txBufferSize: number;
  private _overrunError: boolean = false;
  private _parityError: boolean = false;
  private _framingError: boolean = false;
  private _breakDetected: boolean = false;

  private _onReceiveCallback: ((bytesAvailable: number) => void) | null = null;
  private _onTransmitCompleteCallback: (() => void) | null = null;
  private _onErrorCallback: ((status: UARTStatus) => void) | null = null;

  constructor(uartNumber: number = 0, rxBufferSize: number = 256, txBufferSize: number = 256) {
    this.uartNumber = uartNumber;
    this._rxBufferSize = rxBufferSize;
    this._txBufferSize = txBufferSize;
  }

  // --- IUARTBus methods ---

  enable(baud?: number): void {
    if (baud !== undefined) this.baudRate = baud;
    this.isEnabled = true;
  }

  disable(): void {
    this.isEnabled = false;
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

  readBytes(count: number): Uint8Array {
    if (this._rxBuffer.length < count) {
      const available = this._rxBuffer.splice(0, this._rxBuffer.length);
      return new Uint8Array(available);
    }
    const result = this._rxBuffer.splice(0, count);
    return new Uint8Array(result);
  }

  readString(): string {
    const result = new Uint8Array(this._rxBuffer);
    this._rxBuffer = [];
    return new TextDecoder().decode(result);
  }

  available(): number {
    return this._rxBuffer.length;
  }

  write(data: number | Uint8Array | string): number {
    const bytes = typeof data === 'number'
      ? [data & 0xFF]
      : typeof data === 'string'
        ? this._encodeString(data)
        : Array.from(data);
    return this._pushTxBytes(bytes);
  }

  flush(): void {
    // In simulation, data is "sent" immediately when written to TX buffer.
    // Flush triggers the transmit complete callback.
    if (this._onTransmitCompleteCallback) {
      this._onTransmitCompleteCallback();
    }
  }

  getStatus(): UARTStatusInfo {
    return {
      available: this._rxBuffer.length,
      writeAvailable: this._txBufferSize - this._txBuffer.length,
      overrunError: this._overrunError,
      parityError: this._parityError,
      framingError: this._framingError,
      breakDetected: this._breakDetected,
    };
  }

  clearErrors(): void {
    this._overrunError = false;
    this._parityError = false;
    this._framingError = false;
    this._breakDetected = false;
  }

  onReceive(callback: (bytesAvailable: number) => void): void {
    this._onReceiveCallback = callback;
  }

  onTransmitComplete(callback: () => void): void {
    this._onTransmitCompleteCallback = callback;
  }

  onError(callback: (status: UARTStatus) => void): void {
    this._onErrorCallback = callback;
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

  isConnected(): boolean {
    return this.isEnabled;
  }

  async waitForConnection(_timeout?: number): Promise<void> {
    // In simulation, just resolve immediately
  }

  // --- Simulation helpers ---

  /**
   * Inject bytes into the RX buffer (simulating received data).
   * Triggers onReceive callback if registered.
   */
  injectRx(data: Uint8Array | number[] | string): void {
    const bytes = typeof data === 'string'
      ? this._encodeString(data)
      : Array.isArray(data)
        ? data
        : Array.from(data);

    for (const b of bytes) {
      if (this._rxBuffer.length >= this._rxBufferSize) {
        this._overrunError = true;
        break;
      }
      this._rxBuffer.push(b & 0xFF);
    }

    if (this._onReceiveCallback) {
      this._onReceiveCallback(this._rxBuffer.length);
    }
  }

  /**
   * Get all bytes written to the TX buffer since the last call.
   * Clears the TX buffer.
   */
  flushTx(): number[] {
    const result = this._txBuffer.slice();
    this._txBuffer = [];
    if (this._onTransmitCompleteCallback) {
      this._onTransmitCompleteCallback();
    }
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
    this._overrunError = false;
    this._parityError = false;
    this._framingError = false;
    this._breakDetected = false;
    this.isEnabled = false;
    this.baudRate = 0;
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
