import { uartBegin, uartEnd, uartPrint, uartPrintln, uartWrite, uartRead, uartPeek, uartAvailable, uartFlush, rawCpp } from './emit';

export class SerialPort {
  private _port: string;

  constructor(port: string) {
    this._port = port;
  }

  begin(baud: number = 9600): this {
    uartBegin(this._port, baud);
    return this;
  }

  end(): void {
    uartEnd(this._port);
  }

  print(value: any): void {
    uartPrint(this._port, value);
  }

  println(value: any): void {
    uartPrintln(this._port, value);
  }

  printf(format: string, ...args: any[]): void {
    rawCpp(`${this._port}.printf(${format}, ${args});`);
  }

  write(data: any): void {
    uartWrite(this._port, data);
  }

  read(): number {
    return uartRead(this._port);
  }

  readLine(): string {
    rawCpp(`return ${this._port}.readStringUntil('\\n');`);
    return "";
  }

  peek(): number {
    return uartPeek(this._port);
  }

  available(): number {
    return uartAvailable(this._port);
  }

  flush(): void {
    uartFlush(this._port);
  }

  waitForConnection(): Promise<void> {
    rawCpp(`while (!${this._port}) { delay(10); }`);
    return Promise.resolve();
  }

  take(): this | null {
    // Basic implementation for single-threaded Arduino; 
    // real locking would be framework-specific.
    return this;
  }

  release(): void {
    // No-op for standard Arduino.
  }
}


/** Map TypeCAD UART instance number to Arduino C++ object name. UART0→Serial, UART1→Serial1 */
export function serialName(instance: number): string {
  return instance === 0 ? "Serial" : `Serial${instance}`;
}
