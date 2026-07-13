export declare class TS_Point {
  constructor();
  constructor(x: number, y: number, z: number);
}
export declare class Adafruit_STMPE610 {
  constructor(cspin: number, mosipin: number, misopin: number, clkpin: number);
  constructor(cspin: number, theSPI: number);
  constructor(theWire: number);
  begin(i2caddr: number): any;
  writeRegister8(reg: number, val: number): void;
  readRegister16(reg: number): number;
  readRegister8(reg: number): number;
  readData(x: number, y: number, z: number): void;
  getVersion(): number;
  touched(): any;
  bufferEmpty(): any;
  bufferSize(): number;
  getPoint(): any;
}
