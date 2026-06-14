export enum SensorStatus {
  Ok = 1,
  Warning = 2,
  Error = 3,
}

export const DEFAULT_THRESHOLD = 80;
export const MAX_HISTORY = 100;

export class SensorReading {
  value: number;
  status: SensorStatus;
  timestamp: number;

  constructor(value: number, status: SensorStatus, timestamp: number) {
    this.value = value;
    this.status = status;
    this.timestamp = timestamp;
  }
}