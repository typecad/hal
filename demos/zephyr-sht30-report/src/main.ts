// ---------------------------------------------------------------------------
// main.ts — SHT30 climate reporter (I2C sensor → WiFi → HTTPS POST)
//
// Board: esp32_devkitc/esp32/procpu. Assumptions (change to match your rig):
//   • The SHT30 breakout sits at 0x44 on I2C0. The board's devicetree wires
//     I2C0 to the DevKitC defaults (SDA=GPIO21, SCL=GPIO22). On ESP32 any
//     pad can be any peripheral — different wiring is hand-typed by remuxing
//     the controller (display/touch-style sda/scl config or an overlay), not
//     by picking a different bus object.
//   • The endpoint URL, device id, and CA PEM below are placeholders. Verified
//     TLS pins `CA_PEM`; for lab use swap `caCert` for `insecure: true`.
//
// Shape of the program:
//   • `linkWatch` — async task logging link drops/recoveries every 500 ms.
//   • `reporter`  — async task sampling the SHT30 every 2 s; every 5th sample
//     it builds a JSON report from a rolling 5-sample window (min/max/avg)
//     plus dew point and RSSI, POSTs it, and backs off exponentially on
//     failure.
//   • Both tasks are cooperative: every `await` splits into start+poll states,
//     so neither blocks the other.
//
// The constructors are fact-carriers — joinStart() stages the WiFi join,
// `Sensor`'s part/address facts become a devicetree node in the generated
// overlay, and `Request`'s method/URL/TLS facts lower at send().
// ---------------------------------------------------------------------------

import { WiFi, Request, Sensor, SENSOR, CHAN, I2C0, UART0, Time } from '@typecad/hal';

// ── Configuration ──────────────────────────────────────────────────────────
const WIFI_SSID = 'lab-2g';
const WIFI_PSK = 'battery-horse-staple';

const REPORT_URL = 'https://telemetry.example.com/v1/readings';
const DEVICE_ID = 'sht30-bench-01';

const SAMPLE_PERIOD_MS = 2000;      // one SHT30 fetch per cadence tick
const SAMPLES_PER_REPORT = 5;       // POST once per full rolling window
const REQUEST_TIMEOUT_MS = 15000;
const BASE_BACKOFF_MS = 5000;       // first retry delay after a failed POST
const MAX_BACKOFF_MS = 60000;       // retry ceiling (doubles each failure)

// Placeholder CA bundle — replace with the PEM your endpoint's chain anchors
// to (root or intermediate, PEM armoring, real base64). A fake PEM verifies
// nothing; the TLS handshake fails closed.
const CA_PEM = '-----BEGIN CERTIFICATE-----\n' +
  'MIIBszCCAVmgAwIBAgIUXq8m1Zz6qVYq5d9cUj0m2rT4b4EwCgYIKoZIzj0EAwIw\n' +
  'UzELMAkGA1UEBhMCVVMxFzAVBgNVBAoTDkV4YW1wbGUgT3JnIEluYzEUMBIGA1UE\n' +
  'CxMLT3BlcmF0aW9uczEdMBsGA1UEAxMURXhhbXBsZSBSb290IENBIEhlcmUw\n' +
  'HhcNMjUwMTAxMDAwMDAwWhcNMzUwMTAxMDAwMDAwWjBTMQswCQYDVQQGEwJVUzEX\n' +
  'MBUGA1UEChMORXhhbXBsZSBPcmcgSW5jMRQwEgYDVQQLEwtPcGVyYXRpb25zMR0w\n' +
  'GwYDVQQDExRFeGFtcGxlIFJvb3QgQ0EgSGVyZTBZMBMGByqGSM49AgEGCCqGSM49\n' +
  'AwEHA0IABG8l6rZ9vU0nU5xJq3cP0eWq3L3pJ8Xe6eQ1bF2hYy0uK9dD4wQmT7nJ\n' +
  'x0fOaV5uK2wR9pL3cE1vX7uM5sD2qT6jCgYAwCgYIKoZIzj0EAwIDSAAwRQIhAJ7\n' +
  'm3Xb8QfV2sK5dL9uY1cE4oT2pN6wR8xJ3kH7vZ0Bq1zAiEAogv5cX2mQ9dN7sT4\n' +
  'u1W8pK3bF6yH0jL5rM9xZ2eC4wE=\n' +
  '-----END CERTIFICATE-----\n';

// ── Hardware handles ───────────────────────────────────────────────────────
const wifi = new WiFi(WIFI_SSID, { psk: WIFI_PSK, timeoutMs: 20000 });
const sht30 = new Sensor(SENSOR.sensirion_sht3xd, I2C0.device(0x44));

// ── Pure helpers ───────────────────────────────────────────────────────────
function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : (v > hi ? hi : v);
}

// Magnus-Tetens approximation (a=17.62, b=243.12 °C) — good to ~0.35 °C
// over the -30…70 °C range a basement server closet lives in.
function dewPointC(tempC: number, rhPct: number): number {
  const a = 17.62;
  const b = 243.12;
  const gamma = (a * tempC) / (b + tempC) + Math.log(rhPct / 100.0);
  return (b * gamma) / (a - gamma);
}

// ── Rolling window over the last N samples ─────────────────────────────────
class SampleWindow {
  private readonly _cap: number;
  private readonly _temps: number[];
  private readonly _hums: number[];
  private _head: number;   // next slot to overwrite
  private _fill: number;   // slots written since construction (≤ cap)

  constructor(cap: number) {
    this._cap = cap;
    this._temps = new Array<number>(cap);
    this._hums = new Array<number>(cap);
    this._head = 0;
    this._fill = 0;
  }

  push(tempC: number, rhPct: number): void {
    this._temps[this._head] = tempC;
    this._hums[this._head] = rhPct;
    this._head = (this._head + 1) % this._cap;
    if (this._fill < this._cap) {
      this._fill = this._fill + 1;
    }
  }

  minTemp(): number {
    if (this._fill === 0) { return 0.0; }
    let lo = this._temps[0];
    for (let i = 1; i < this._fill; i = i + 1) {
      if (this._temps[i] < lo) { lo = this._temps[i]; }
    }
    return lo;
  }

  maxTemp(): number {
    if (this._fill === 0) { return 0.0; }
    let hi = this._temps[0];
    for (let i = 1; i < this._fill; i = i + 1) {
      if (this._temps[i] > hi) { hi = this._temps[i]; }
    }
    return hi;
  }

  avgTemp(): number {
    if (this._fill === 0) { return 0.0; }
    let sum = 0.0;
    for (let i = 0; i < this._fill; i = i + 1) {
      sum = sum + this._temps[i];
    }
    return sum / this._fill;
  }

  avgHum(): number {
    if (this._fill === 0) { return 0.0; }
    let sum = 0.0;
    for (let i = 0; i < this._fill; i = i + 1) {
      sum = sum + this._hums[i];
    }
    return sum / this._fill;
  }
}

// ── Payload — pure string building, no hardware calls ──────────────────────
function reportJson(win: SampleWindow, tempC: number, rhPct: number,
                    rssi: number, seq: number, uptimeMs: number): string {
  const dp = dewPointC(tempC, rhPct);
  return `{"device":"${DEVICE_ID}",` +
    `"seq":${seq},` +
    `"temp_c":${tempC.toFixed(2)},` +
    `"rh_pct":${rhPct.toFixed(1)},` +
    `"dew_c":${dp.toFixed(2)},` +
    `"temp_min_c":${win.minTemp().toFixed(2)},` +
    `"temp_max_c":${win.maxTemp().toFixed(2)},` +
    `"temp_avg_c":${win.avgTemp().toFixed(2)},` +
    `"rh_avg_pct":${win.avgHum().toFixed(1)},` +
    `"rssi_dbm":${rssi},` +
    `"uptime_ms":${Math.floor(uptimeMs)}}`;
}

// ── Shared counters (mutated from both tasks) ──────────────────────────────
let reportsSent = 0;
let reportFailures = 0;

// ── Task 1 — link watchdog ─────────────────────────────────────────────────
async function linkWatch() {
  let wasUp = false;
  while (true) {
    const up = wifi.linked();
    if (up && !wasUp) {
      UART0.writeLine(`[link] up — ip=${wifi.ip()} rssi=${wifi.rssi()} dBm`);
    }
    if (!up && wasUp) {
      UART0.writeLine('[link] lost — reporting pauses until it returns');
    }
    wasUp = up;
    await Time.sleep(500);
  }
}

// ── Task 2 — sample, aggregate, report ─────────────────────────────────────
async function reporter() {
  const recent = new SampleWindow(SAMPLES_PER_REPORT);
  let seq = 0;
  let backoffMs = BASE_BACKOFF_MS;

  while (true) {
    if (!wifi.linked()) {
      await Time.sleep(1000);
      continue;
    }

    // One sample round. The sensor's DT node (generated from the
    // constructor facts) drives Zephyr's sht3xd driver: fetch reads the
    // part (CRC-checked on device), get() converts one channel to °C / %RH.
    sht30.fetch();
    const tempC = sht30.get(CHAN.AMBIENT_TEMP);
    const rhPct = sht30.get(CHAN.HUMIDITY);
    recent.push(tempC, rhPct);
    seq = seq + 1;

    // Report once the rolling window holds a full complement of samples.
    if (seq % SAMPLES_PER_REPORT === 0) {
      const body = reportJson(recent, tempC, rhPct, wifi.rssi(), seq, Time.now());
      const req = new Request(Request.POST, REPORT_URL, {
        body: body,
        json: true,
        timeoutMs: REQUEST_TIMEOUT_MS,
        caCert: CA_PEM,
      });
      req.header('X-Device', DEVICE_ID);

      // Statement-position await: the request runs on the system workqueue
      // while this task yields; read the outcome through the request after
      // it completes (value-position `const r = await …` is unsupported).
      await req.send();
      if (req.ok()) {
        reportsSent = reportsSent + 1;
        backoffMs = BASE_BACKOFF_MS;
        UART0.writeLine(`[report] #${reportsSent} seq=${seq} status=${req.status()} t=${tempC.toFixed(2)}C rh=${rhPct.toFixed(1)}%`);
      } else {
        reportFailures = reportFailures + 1;
        const waitMs = clamp(backoffMs, BASE_BACKOFF_MS, MAX_BACKOFF_MS);
        UART0.writeLine(`[report] failed (#${reportFailures}) status=${req.status()} — retry in ${waitMs / 1000} s`);
        backoffMs = backoffMs * 2;
        await Time.sleep(waitMs);
      }
    }

    await Time.sleep(SAMPLE_PERIOD_MS);
  }
}

// ── Boot ───────────────────────────────────────────────────────────────────
UART0.writeLine(`[boot] ${DEVICE_ID} — SHT30 @ 0x44 on I2C0, reporting to ${REPORT_URL}`);
wifi.joinStart();     // stage the join; the tasks poll from here
linkWatch();
reporter();
