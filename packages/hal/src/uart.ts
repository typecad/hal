// ---------------------------------------------------------------------------
// SerialPort — controller identity carrier (legacy UART API removed)
//
// The class carries ONLY the controller identity (the canonical controller
// name: UART0, UART1, …). Generated board modules construct the singletons;
// program-level serial is the thin `UART` (uart-port.ts — interrupt-drained
// RX ring + poll TX, construction baud) or `USBConsole` (usb.ts) for the CDC
// connector. The former print/printf/read/peek/available/waitForConnection
// surface was removed with the legacy Arduino surface.
// ----------------------------------------------------------------------------

export class SerialPort {
  private _port: string;

  constructor(port: string) {
    this._port = port;
  }
}
