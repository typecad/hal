// ---------------------------------------------------------------------------
// USBConsole — the thin CDC-ACM console
//
// A serial pipe over the board's USB connector (Communication Device Class,
// Abstract Control Model). The construction fact is the port identity
// ('USB0' — the CDC instance index the devicetree overlay composes); the
// verbs map 1:1 onto Zephyr's CDC device stack:
//
//   open()            → start the USB device stack (idempotent; CDC has no
//                       wire baud — line coding is the host's business)
//   close()           → observable no-op (tearing down the shared device
//                       stack would drop every other CDC instance)
//   write(v)          → one typed write (text | number | boolean — the
//   writeLine(v)        __tc_print contract, not print(any))
//   linked()          → the host has the port open (DTR asserted); output
//                       written before this is silently dropped by hosts
//   waitLinked(ms)    → ONE op: bounded DTR poll in the shim (k_msleep
//                       slices), boolean, no user-code busy loop. 0 = forever.
//   read()/available()→ poll RX (the byte or -1 / a ready count)
//
// Unlike a hardware UART, output before the host opens the port is lost —
// gate on linked()/waitLinked() when early output matters.
// ----------------------------------------------------------------------------

import {
  usbBegin, usbEnd, usbPrint, usbPrintln,
  usbRead, usbAvailable, usbConnected, usbWaitReady,
} from './emit.js';
import type { SerialValue } from './types.js';

export class USBConsole {
  private readonly _port: string;

  /** Construct the console for a CDC instance ('USB0' = instance 0). */
  constructor(port: string = 'USB0') {
    this._port = port;
  }

  /** Start the USB device stack and bring the CDC port up. Idempotent. */
  open(): void {
    usbBegin(this._port);
  }

  /** Stop using the port. Observable no-op on Zephyr — the device stack is
   *  shared by every CDC instance and is not torn down per-port. */
  close(): void {
    usbEnd(this._port);
  }

  /** Write text, a number, or a boolean. Numbers format as decimal;
   *  booleans print as 1/0. */
  write(value: SerialValue): void {
    usbPrint(this._port, value);
  }

  /** Write a value followed by a newline. */
  writeLine(value: SerialValue): void {
    usbPrintln(this._port, value);
  }

  /** True when the host has the port open (DTR asserted). Output written
   *  before this is true is silently dropped by most hosts. */
  linked(): boolean {
    return usbConnected(this._port);
  }

  /** Block until the host opens the port, polling in the shim (no user-code
   *  busy loop). `timeoutMs` 0 = wait forever. Returns true once linked. */
  waitLinked(timeoutMs: number = 0): boolean {
    return usbWaitReady(this._port, timeoutMs);
  }

  /** Read one byte, or -1 when no byte is ready (non-blocking). */
  read(): number {
    return usbRead(this._port);
  }

  /** Bytes ready to read (the CDC poll path reports 0/1 — see the lowering). */
  available(): number {
    return usbAvailable(this._port);
  }
}
