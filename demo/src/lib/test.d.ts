export declare const BME280_ADDRESS: number;
export declare const REG_CTRL_MEAS: number;
export declare const REG_CTRL_HUM: number;
export declare const REG_CONFIG: number;
export declare const REG_TEMP_MSB: number;
export declare const REG_CALIB_00: number;

export declare class test {
  constructor(address: number);
  begin(): boolean;
  readTemperature(): number;
  readHumidity(): number;
  readPressure(): number;
}
