// ---------------------------------------------------------------------------
// Example 23 — Arduino Uno Validation Showcase
//
// This version is intentionally stock-Uno friendly. It exercises the core
// transpiler features that are easiest to verify on a real board by simply
// opening the serial monitor at 115200 baud.
// ---------------------------------------------------------------------------

import { A0, LED, UART0, delay } from '@typecode';

enum SystemMode {
  Idle = 0,
  Monitor = 1,
  Alarm = 2,
}

let cycle = 0;
let x = 1;
let enabled = true;

const label = 'uno-showcase';
const gain = 2;

const baseline: ReadonlyArray<number> = [10, 20, 30, 40];
const packet = new Uint8Array([0xAA, 0x10, 0x20]);
const offsets = new Int16Array([4, -2, 7]);
const weights = new Float32Array([1.0, 0.5, 0.25]);

const config = {
  low: 150,
  high: 700,
  timeout: 750,
};

const { low, high, timeout = 500 } = config;
const [startByte = 0, commandByte = 0, dataByte = 0] = packet;

function clamp(value: number, min: number = 0, max: number = 1023): number {
  return Math.max(min, Math.min(max, value));
}

function baselineSum(): number {
  let total = 0;

  for (const value of baseline) {
    total += value;
  }

  return total;
}

function checksum3(a: number, b: number, c: number): number {
  return ((a << 8) | b) ^ c;
}

function classify(value: number): SystemMode {
  if (value < low) {
    return SystemMode.Idle;
  }

  if (value > high) {
    return SystemMode.Alarm;
  }

  return SystemMode.Monitor;
}

function describeMode(mode: SystemMode): string {
  switch (mode) {
    case SystemMode.Idle:
      return 'idle';
    case SystemMode.Monitor:
      return 'monitor';
    case SystemMode.Alarm:
      return 'alarm';
    default:
      return 'unknown';
  }
}

class OffsetMeter {
  read(value: number): number {
    return value + offsets[0];
  }
}

const meter = new OffsetMeter();
const led = LED.asOutput(false);
const serial = UART0.begin(115200);

A0.asInput();

serial.println('TypeCode Uno validation showcase');
serial.println('Watch the lines below to confirm the transpiled output.');

while (true) {
  const y = x + 2;
  const raw = A0.readAnalog();
  const scaled = clamp(raw * gain, 0, 1023);
  const adjusted = meter.read(y);
  const baselineTotal = baselineSum();
  const checksum = checksum3(startByte, commandByte, dataByte);
  const mode = classify(raw);
  const weightScore = clamp((weights[0] + weights[1] + weights[2]) * 100, 0, 999);

  serial.println(`label=${label} cycle=${cycle}`);
  serial.println(`x=${x} y=${y} enabled=${enabled}`);
  serial.println(`sum=${baselineTotal} checksum=${checksum}`);
  serial.println(`offset0=${offsets[0]} adjusted=${adjusted}`);
  serial.println(`raw=${raw} scaled=${scaled} weightScore=${weightScore}`);
  serial.println(`mode=${describeMode(mode)} low=${low} high=${high}`);
  serial.println(`timeout=${timeout} bytes=${startByte},${commandByte},${dataByte}`);

  if (enabled) {
    led.toggle();
  } else {
    led.low();
  }

  enabled = !enabled;
  x = x + 1;
  cycle = cycle + 1;

  if (cycle > 4) {
    cycle = 0;
    serial.println('----');
  }

  delay(timeout);
}
