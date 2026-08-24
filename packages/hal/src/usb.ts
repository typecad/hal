// ---------------------------------------------------------------------------
// USB CDC-ACM serial port
//
// A serial pipe over the board's USB connector (Communication Device Class,
// Abstract Control Model). Frameworks with a USB device stack lower these
// calls to the CDC class instance; the composition (controller + class
// instances) is generated devicetree, not runtime code. Unlike a hardware
// UART, output before the host opens the port is lost — gate on
// connected() when early output matters.
// ---------------------------------------------------------------------------

import {
  usbBegin, usbEnd, usbPrint, usbPrintln, usbPrintf, usbWrite,
  usbRead, usbAvailable, usbFlush, usbConnected, delayMs, getMillis,
} from './emit.js';

export class USBSerialPort {
  private _port: string;

  constructor(port: string) {
    this._port = port;
  }

  /** Enable the USB device and open the CDC port. `baud` is a line-coding
   *  hint only — CDC has no wire baud. Idempotent. */
  begin(baud: number = 115200): this {
    usbBegin(this._port, baud);
    return this;
  }

  /** Disable the CDC port. */
  end(): void {
    usbEnd(this._port);
  }

  print(value: any): void {
    usbPrint(this._port, value);
  }

  println(value: any): void {
    usbPrintln(this._port, value);
  }

  printf(format: string, ...args: any[]): void {
    usbPrintf(this._port, format, args);
  }

  write(data: any): void {
    usbWrite(this._port, data);
  }

  /** Read one byte, or -1 when no byte is ready (non-blocking). */
  read(): number {
    return usbRead(this._port);
  }

  available(): number {
    return usbAvailable(this._port);
  }

  flush(): void {
    usbFlush(this._port);
  }

  /** True when the host has the port open (DTR asserted). Output written
   *  before this is true is silently dropped by most hosts. */
  connected(): boolean {
    return usbConnected(this._port);
  }

  /** Block until the host opens the port (or timeout ms elapses; 0 = wait
   *  forever). Returns true when connected. */
  waitForConnection(timeout: number = 0): boolean {
    const deadline: number = timeout > 0 ? getMillis() + timeout : 0;
    while (!this.connected()) {
      if (deadline !== 0 && getMillis() >= deadline) return false;
      delayMs(10);
    }
    return true;
  }
}
