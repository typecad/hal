export declare class TS_Point {
  constructor();
  constructor(x: number, y: number, z: number);
}
export declare class Adafruit_TSC2007 {
  constructor();
  begin(address: number, wire: number): boolean;
  command(func: any, pwr: any, res: any): number;
  read_touch(x: number, y: number, z1: number, z2: number): boolean;
  getPoint(): any;
}
