// ---------------------------------------------------------------------------
// dht.ts — bit-banged one-wire driver (DHT22/AM2302 protocol)
//
// The bus is open-drain: drive low for the ≥1 ms start pulse, release, then
// time the sensor's response edges with Time.nowUs(). Each of the 40 data
// bits is a 50 µs low followed by a high whose width encodes the value
// (<40 µs = 0, >40 µs = 1). The five payload bytes ride a Uint8Array; the
// last byte is a checksum over the first four. Every wait is deadline-bounded
// so an absent sensor returns null instead of hanging.
// ---------------------------------------------------------------------------

import { GPIO, Time } from '@typecad/hal';

export type DhtReading = { tempC: number; humidity: number };

const BIT_US_THRESHOLD = 40;
const MAX_READS = 6;

export class Dht22 {
  // NOTE: field-INITIALIZED HAL instance on a fixed pin — the supported
  // shape. HAL classes have no C++ value type, so a constructor cannot take
  // `pin: GPIO` nor can a field be reassigned from a ctor parameter (both
  // lower to raw `new GPIO` text with no member to assign — see the
  // findings suite's documented-open pin).
  private sense = new GPIO(8, GPIO.OUTPUT | GPIO.PULL_UP);
  private lastOkMs: number = 0;
  private badCrc = 0;
  private timeouts = 0;

  get okAge(): number {
    return this.lastOkMs === 0 ? -1 : Time.now() - this.lastOkMs;
  }

  get health(): string {
    return `ok_age=${this.okAge} badCrc=${this.badCrc} timeouts=${this.timeouts}`;
  }

  /** Wait until the pin reaches `level`, or the µs deadline passes. */
  private awaitLevel(level: boolean, timeoutUs: number): boolean {
    const start = Time.nowUs();
    while (Time.nowUs() - start < timeoutUs) {
      if (this.sense.get() === level) {
        return true;
      }
      Time.busyWaitUs(1);
    }
    this.timeouts += 1;
    return false;
  }

  /** One full read; null on any timeout or checksum failure. */
  read(): DhtReading | null {
    const bytes = new Uint8Array(5);

    // Start pulse: low ≥ 1 ms, release 20 µs, then the sensor's three
    // response edges (80 low / 80 high).
    this.sense.set(false);
    Time.busyWaitUs(1100);
    this.sense.set(true);
    Time.busyWaitUs(20);
    if (!this.awaitLevel(false, 60)) {
      return null;
    }
    if (!this.awaitLevel(true, 90)) {
      return null;
    }
    if (!this.awaitLevel(false, 90)) {
      return null;
    }

    // 40 bits, MSB first, packed into five bytes.
    for (let i = 0; i < 40; i += 1) {
      if (!this.awaitLevel(true, 80)) {
        return null;
      }
      const highStart = Time.nowUs();
      if (!this.awaitLevel(false, 100)) {
        return null;
      }
      const highUs = Time.nowUs() - highStart;
      const bit = highUs > BIT_US_THRESHOLD ? 1 : 0;
      const byte = Math.floor(i / 8);
      bytes[byte] = bytes[byte] | (bit << (7 - (i % 8)));
    }

    // Checksum: low byte of the sum of the first four payload bytes.
    const sum = (bytes[0] + bytes[1] + bytes[2] + bytes[3]) & 0xff;
    if (sum !== bytes[4]) {
      this.badCrc += 1;
      return null;
    }

    this.lastOkMs = Time.now();
    const humidity = ((bytes[0] << 8) | bytes[1]) * 0.1;
    const negative = (bytes[2] & 0x80) !== 0;
    const magnitude = (((bytes[2] & 0x7f) << 8) | bytes[3]) * 0.1;
    return { tempC: negative ? -magnitude : magnitude, humidity: humidity };
  }

  /** Retry wrapper: up to MAX_READS attempts with a 2 s cool-down. */
  readRetried(): DhtReading | null {
    for (let attempt = 0; attempt < MAX_READS; attempt += 1) {
      const r = this.read();
      if (r !== null) {
        return r;
      }
      Time.sleep(20);
    }
    return null;
  }
}
