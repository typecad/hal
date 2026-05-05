import { emit } from './emit';

export class SerialPort {
  private _port: string;

  constructor(port: string) {
    this._port = port;
  }

  begin(baud: number = 9600): this {
    emit(`${this._port}.begin(${baud});`);
    return this;
  }

  end(): void {
    emit(`${this._port}.end();`);
  }

  print(value: any): void {
    emit(`${this._port}.print(${value});`);
  }

  println(value: any): void {
    emit(`${this._port}.println(${value});`);
  }

  printf(format: string, ...args: any[]): void {
    emit(`${this._port}.printf(${format}, ${args});`);
  }

  write(data: any): void {
    emit(`${this._port}.write(${data});`);
  }

  read(): number {
    emit(`return ${this._port}.read();`);
    return 0;
  }

  readLine(): string {
    emit(`return ${this._port}.readStringUntil('\n');`);
    return "";
  }

  peek(): number {
    emit(`return ${this._port}.peek();`);
    return 0;
  }

  available(): number {
    emit(`return ${this._port}.available();`);
    return 0;
  }

  flush(): void {
    emit(`${this._port}.flush();`);
  }

  waitForConnection(): Promise<void> {
    emit(`while (!${this._port}) { delay(10); }`);
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


/** Map TypeHAL UART instance number to Arduino C++ object name. UART0→Serial, UART1→Serial1 */
export function serialName(instance: number): string {
  return instance === 0 ? "Serial" : `Serial${instance}`;
}
