import { SensorReading, SensorStatus, DEFAULT_THRESHOLD } from "../models/SensorTypes";

export { SensorStatus } from "../models/SensorTypes";

export class SensorProcessor {
  private readings: SensorReading[] = [];
  private threshold: number;
  private counter: number;

  constructor(threshold: number) {
    this.threshold = threshold;
    this.counter = 0;
  }

  addReading(value: number): void {
    let status = SensorStatus.Ok;
    if (value < 0) {
      status = SensorStatus.Error;
    } else if (value > this.threshold) {
      status = SensorStatus.Warning;
    }
    this.counter++;
    const reading = new SensorReading(value, status, this.counter);
    this.readings.push(reading);
  }

  getReadings(): SensorReading[] {
    return this.readings;
  }

  getLastIndex(): number {
    if (this.readings.length === 0) {
      return -1;
    }
    return this.readings.length - 1;
  }

  getAverage(): number {
    if (this.readings.length === 0) {
      return 0;
    }
    let sum = 0;
    for (const r of this.readings) {
      sum += r.value;
    }
    return sum / this.readings.length;
  }

  getHistory(): number[] {
    const result: number[] = [];
    for (const r of this.readings) {
      result.push(r.value);
    }
    return result;
  }

  filterAbove(threshold: number): SensorReading[] {
    const result: SensorReading[] = [];
    for (const r of this.readings) {
      if (r.value > threshold) {
        result.push(r);
      }
    }
    return result;
  }

  countErrors(): number {
    let count = 0;
    for (const r of this.readings) {
      if (r.status == SensorStatus.Error) {
        count++;
      }
    }
    return count;
  }

  clear(): void {
    this.readings = [];
  }
}

export function clampValue(value: number, min: number, max: number): number {
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

export function calculateMovingAverage(values: number[], window: number): number[] {
  const result: number[] = [];
  for (let i = 0; i <= values.length - window; i++) {
    let sum = 0;
    for (let j = 0; j < window; j++) {
      sum += values[i + j];
    }
    result.push(sum / window);
  }
  return result;
}

export function formatReading(reading: SensorReading): string {
  let statusName = "Unknown";
  if (reading.status == SensorStatus.Ok) {
    statusName = "Ok";
  } else if (reading.status == SensorStatus.Warning) {
    statusName = "Warning";
  } else if (reading.status == SensorStatus.Error) {
    statusName = "Error";
  }
  return `${reading.timestamp}:${reading.value}:${statusName}`;
}