import { emit } from './emit';

export class SerialPort {
  private _port: string;

  constructor(port: string) {
    this._port = port;
  }

  begin(baud: number = 9600): void {
    emit(`${this._port}.begin(${baud});`);
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

  write(data: any): void {
    emit(`${this._port}.write(${data});`);
  }

  read(): number {
    return 0;
  }

  available(): number {
    return 0;
  }

  flush(): void {
    emit(`${this._port}.flush();`);
  }
}

/** Map TypeHAL UART instance number to Arduino C++ object name. UART0→Serial, UART1→Serial1 */
export function serialName(instance: number): string {
  return instance === 0 ? "Serial" : `Serial${instance}`;
}
