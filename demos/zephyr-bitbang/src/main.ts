// ---------------------------------------------------------------------------
// main.ts — Bit-bang DHT22 station (Black Pill, multi-file program)
//
// The sensor's power rail is gated through a config register (the write
// path of the @register machinery); the async task loop reads the DHT22,
// converts through the Metrics namespace, and reports. Optional chaining
// carries the nullable reading into the report; ??= seeds the alarm bound
// on first use.
// ---------------------------------------------------------------------------

import {
  GPIO, UART, Time, Watchdog,
  register, bits, Bit, Bits,
} from '@typecad/hal';
import { Dht22 } from './dht';
import { Metrics } from './metrics';

// ── Identity / tunables ────────────────────────────────────────────────────
const FW_VERSION = '1.0.0';
const READ_MS = 5000;
const REPORT_MS = 10000;

// Sensor power-rail gate (board-specific enable pad on the config bus).
@register(0x40023830)
class RailCfg {
  @bits(0, 0)
  static sensePwr: Bit = 0;

  @bits(9, 8)
  static drive: Bits<2> = 0;
}

// ── Hardware ───────────────────────────────────────────────────────────────
const console = new UART('UART0', { baud: 115200, rxBufferBytes: 96 });
const sensorPower = new GPIO(8, GPIO.OUTPUT);
const dht = new Dht22();

// ── Station state ──────────────────────────────────────────────────────────
let lastTempC: number | null = null;
let lastRh: number | null = null;
let reads = 0;
let misses = 0;
let peakTempC = -100.0;
let alarmHigh: number | null = null;

// ── Tasks ──────────────────────────────────────────────────────────────────
async function sampler(): Promise<void> {
  while (true) {
    const r = dht.readRetried();
    if (r !== null) {
      reads += 1;
      lastTempC = r.tempC;
      lastRh = r.humidity;
      if (r.tempC > peakTempC) {
        peakTempC = r.tempC;
      }
    } else {
      misses += 1;
    }
    await Time.sleep(READ_MS);
  }
}

async function reporter(): Promise<void> {
  // ??= — seed the alarm bound on first use (a stored/config value would
  // already be set; here it starts null).
  alarmHigh ??= 32.0;

  while (true) {
    // Optional chaining over the nullable reading: when no sample has ever
    // landed, the whole chain falls to the dash.
    // NOTE: ternary form — a prototype method through `?.` on a number
    // still renders verbatim (see findings suite, documented-open).
    const tempText = lastTempC === null ? '-' : lastTempC.toFixed(1);
    const rhText = lastRh === null ? '-' : lastRh.toFixed(0);
    const dew = lastTempC !== null && lastRh !== null
      ? Metrics.dewPointC(lastTempC, lastRh).toFixed(1)
      : '-';
    const comfort = lastTempC !== null && lastRh !== null
      ? Metrics.comfort(lastTempC, lastRh)
      : 'n/a';
    const dry = lastTempC !== null && lastRh !== null
      ? Metrics.drynessScore(lastTempC, lastRh)
      : 0;
    const capLo = 0.0;
    const capHi = 60.0;
    const capped = Metrics.clamp(dry, capLo, capHi);
    const alarm = lastTempC !== null && lastTempC > (alarmHigh ?? 32.0) ? ' ALARM' : '';

    console.writeLine(
      `[env] T=${tempText}C rh=${rhText}% dew=${dew}C comfort=${comfort} ` +
      `dry=${capped} peak=${peakTempC === -100.0 ? '-' : peakTempC.toFixed(1)} ` +
      `reads=${reads} miss=${misses}${alarm}`
    );
    console.writeLine(`[drv] ${dht.health}`);
    await Time.sleep(REPORT_MS);
  }
}

// ── Boot ───────────────────────────────────────────────────────────────────
console.writeLine(`[boot] bitbang station fw ${FW_VERSION}`);

// Power the sensor rail through the config register (the @register write
// path: masked read-modify-write of the mapped word).
RailCfg.drive = 2;
RailCfg.sensePwr = 1;
console.writeLine(`[boot] rail: drive=${RailCfg.drive} pwr=${RailCfg.sensePwr}`);
sensorPower.set(true);

Time.sleep(2000); // DHT22 needs 1–2 s after power-on

const watchdog = new Watchdog(8000);
watchdog.enable();

sampler();
reporter();
