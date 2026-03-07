export declare class BH1750 {
  constructor(addr: any);
  begin(mode: any, addr: any, i2c: number): boolean;
  configure(mode: any): boolean;
  setMTreg(MTreg: any): boolean;
  measurementReady(maxWait: boolean): boolean;
  readLightLevel(): number;
}
