// ---------------------------------------------------------------------------
// main.ts — Utility Meter Logger (Black Pill)
//
// Three execution contexts share this program, the way real meter firmware
// does:
//   · ISR    — the meter pulse input increments a volatile counter
//   · thread — a flusher that writes the sample ring to /lfs CSV
//   · main   — the superloop: samples the ring, runs the console, feeds the
//              watchdog
//
//   pulses: BUTTON pad (PA0) on falling edges — 1000 pulses = 1 unit
//   temp:   PA1 pot as a pretend temperature sensor (mV → °C)
//   vbat:   PA2 pot as a pretend battery divider (mV)
//   log:    /lfs/meter.csv — rewritten whole from the ring on each flush
//   totals: lifetime pulses + flush count in settings (survives reflash)
// ---------------------------------------------------------------------------

import {
  GPIO, LED, BUTTON, PA1, PA2,
  UART, ADC, Store, File, Time, Thread, Watchdog,
} from '@typecad/hal';

// ── Identity / tunables ────────────────────────────────────────────────────
const FW_VERSION = '2.0.1';
const LOG_PATH = '/lfs/meter.csv';
const TOTALS_NS = 'meter';

const RING_CAP = 24;
const SAMPLE_MS = 200;
const FLUSH_EVERY_SAMPLES = 10;   // ring flush cadence
const CONSOLE_MS = 10;
const TELEM_MS = 5000;
const WDOG_MS = 400;

const PULSES_PER_UNIT = 1000;     // meter constant
const MV_SPAN = 3300.0;
const C_SPAN = 100.0;
const C_OFFSET = -10.0;
const VBAT_SCALE = 2.0;           // divider: pin mV × 2 = battery mV

// ── Sample record + fixed-capacity ring ────────────────────────────────────
type Sample = { tMs: number; pulses: number; tempC: number; vbatmV: number };

class SampleRing {
  private cap: number;
  private buf: Sample[] = [];
  private head = 0;
  private count = 0;

  constructor(capacity: number) {
    this.cap = capacity;
    for (let i = 0; i < capacity; i += 1) {
      this.buf.push({ tMs: 0, pulses: 0, tempC: 0.0, vbatmV: 0.0 });
    }
  }

  /** Overwrite the oldest slot; the ring is pre-zeroed so reads are total. */
  push(s: Sample): void {
    this.buf[this.head] = s;
    this.head = (this.head + 1) % this.cap;
    if (this.count < this.cap) {
      this.count += 1;
    }
  }

  get filled(): number {
    return this.count;
  }

  /** Oldest-first read of slot i (0 = oldest retained sample). */
  at(i: number): Sample {
    const start = this.head - this.count;
    const idx = (start + i + this.cap * 2) % this.cap;
    return this.buf[idx];
  }
}

// ── Hardware ───────────────────────────────────────────────────────────────
const console = new UART('UART0', { baud: 115200, rxBufferBytes: 128 });
const tempSense = new ADC(PA1);
const vbatSense = new ADC(PA2);
const pulseInput = new GPIO(BUTTON, GPIO.INPUT | GPIO.PULL_UP);
const led = new GPIO(LED, GPIO.OUTPUT);

// ── ISR context: pulse counting ────────────────────────────────────────────
let pulseCount = 0;

pulseInput.onInterrupt(GPIO.INT_EDGE_FALLING, () => {
  pulseCount += 1;
});

// ── Totals persisted in settings ───────────────────────────────────────────
const totals = new Store(TOTALS_NS);
let lifetimePulses = 0;
let flushCount = 0;

function loadTotals(): void {
  lifetimePulses = totals.getInt('pulses', 0);
  flushCount = totals.getInt('flushes', 0);
}

function saveTotals(): void {
  totals.setInt('pulses', lifetimePulses);
  totals.setInt('flushes', flushCount);
}

// ── The shared ring + flush handshake (main ↔ thread) ─────────────────────
let ring = new SampleRing(RING_CAP);
let flushPending = false;
let samplesSinceFlush = 0;

function toCsvLine(s: Sample): string {
  return `${s.tMs},${s.pulses},${s.tempC.toFixed(1)},${s.vbatmV}`;
}

function writeLog(): number {
  // File.write replaces the file, so the flush rewrites the whole retained
  // window — bounded work per flush, and the CSV is always consistent.
  const log = new File(LOG_PATH);
  let out = 'uptime_ms,pulses,temp_c,vbat_mv\n';
  for (let i = 0; i < ring.filled; i += 1) {
    const s: Sample = ring.at(i);
    out += toCsvLine(s) + '\n';
  }
  log.write(out);
  flushCount += 1;
  lifetimePulses += pulseCount;
  saveTotals();
  return ring.filled;
}

// The flusher thread: polls the handshake flag, writes, reports, sleeps.
const flusher = new Thread(0, { stackKb: 2 });

function flusherBody(): void {
  while (true) {
    if (flushPending) {
      flushPending = false;
      const wrote = writeLog();
      console.writeLine(`[log] flushed ${wrote} rows (#${flushCount})`);
    }
    Time.sleep(100);
  }
}

// ── Console: line assembler + commands ─────────────────────────────────────
const PRINTABLE = ' !"#$%&\'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_`abcdefghijklmnopqrstuvwxyz{|}~';

class LineReader {
  private buf = '';

  feed(b: number): string | null {
    if (b === 13 || b === 10) {
      const line = this.buf;
      this.buf = '';
      return line.length > 0 ? line : null;
    }
    if (b >= 32 && b <= 126) {
      this.buf += PRINTABLE.substring(b - 32, b - 31);
    }
    return null;
  }
}

const reader = new LineReader();

function uptimeText(): string {
  const s = Math.floor(Time.now() / 1000) % 60;
  const m = Math.floor(Time.now() / 60000) % 60;
  const h = Math.floor(Time.now() / 3600000);
  return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

function handleLine(line: string): void {
  const parts = line.trim().split(' ');
  if (parts.length === 0 || parts[0] === '') {
    return;
  }
  switch (parts[0].toLowerCase()) {
    case 'help':
      console.writeLine(`fw ${FW_VERSION} — status dump totals clear factory`);
      break;
    case 'status': {
      const units = pulseCount / PULSES_PER_UNIT;
      console.writeLine(
        `${uptimeText()} pulses=${pulseCount} (${units.toFixed(3)}u) ` +
        `ring=${ring.filled}/${RING_CAP} flushes=${flushCount} ` +
        `life=${lifetimePulses} pend=${flushPending ? 1 : 0}`
      );
      break;
    }
    case 'dump': {
      const log = new File(LOG_PATH);
      const text = log.read();
      const rows = text.trim().split('\n');
      console.writeLine(`--- ${rows.length} lines ---`);
      for (let i = 0; i < rows.length && i < 6; i += 1) {
        console.writeLine(rows[i]);
      }
      break;
    }
    case 'totals':
      console.writeLine(`lifetime=${lifetimePulses} flushes=${flushCount}`);
      break;
    case 'clear':
      ring = new SampleRing(RING_CAP);
      pulseCount = 0;
      console.writeLine('ring + session pulses cleared (log file intact)');
      break;
    case 'factory': {
      const log = new File(LOG_PATH);
      log.remove();
      lifetimePulses = 0;
      flushCount = 0;
      pulseCount = 0;
      saveTotals();
      console.writeLine('log removed, totals zeroed');
      break;
    }
    default:
      console.writeLine(`unknown command '${parts[0]}' (try help)`);
      break;
  }
}

function pollConsole(): void {
  while (console.available() > 0) {
    const line = reader.feed(console.read());
    if (line !== null) {
      handleLine(line);
    }
  }
}

// ── Sampling: pulses delta + filtered temp + vbat ──────────────────────────
let lastPulseSnapshot = 0;
let emaTempC = 0.0;
let vbatmV = 0.0;

function sampleTick(): void {
  const now = Time.now();
  const delta: number = pulseCount - lastPulseSnapshot;
  lastPulseSnapshot = pulseCount;

  const mv = tempSense.readMillivolts();
  const rawC = (mv / MV_SPAN) * C_SPAN + C_OFFSET;
  emaTempC = emaTempC + 0.25 * (rawC - emaTempC);

  vbatmV = vbatSense.readMillivolts() * VBAT_SCALE;

  ring.push({ tMs: now, pulses: delta, tempC: emaTempC, vbatmV: vbatmV });

  samplesSinceFlush += 1;
  if (samplesSinceFlush >= FLUSH_EVERY_SAMPLES) {
    samplesSinceFlush = 0;
    flushPending = true;
  }
}

// ── Telemetry heartbeat ────────────────────────────────────────────────────
let beats = 0;

function telemetryTick(): void {
  beats += 1;
  led.set(beats % 2 === 0);
  console.writeLine(
    `[tel] ${uptimeText()} T=${emaTempC.toFixed(1)}C bat=${vbatmV.toFixed(0)}mV pulses=${pulseCount}`
  );
}

// ── Boot: self-test (file round-trip), totals, flusher, watchdog ───────────
console.writeLine(`[boot] meter-logger fw ${FW_VERSION}`);
{
  const probe = new File('/lfs/selftest.txt');
  probe.write('ok');
  if (probe.read() === 'ok') {
    console.writeLine('[boot] fs selftest ok');
    probe.remove();
  } else {
    console.writeLine('[boot] fs selftest FAILED — logging disabled');
  }
}
loadTotals();
console.writeLine(`[boot] totals: life=${lifetimePulses} flushes=${flushCount}`);

flusher.start(flusherBody);

const watchdog = new Watchdog(WDOG_MS * 4);
watchdog.enable();
console.writeLine('[boot] watchdog armed, entering superloop');

// ── Superloop ──────────────────────────────────────────────────────────────
let lastSampleMs = 0;
let lastConsoleMs = 0;
let lastTelemMs = 0;
let lastWdogMs = 0;

while (true) {
  const now = Time.now();
  if (now - lastSampleMs >= SAMPLE_MS) {
    lastSampleMs = now;
    sampleTick();
  }
  if (now - lastConsoleMs >= CONSOLE_MS) {
    lastConsoleMs = now;
    pollConsole();
  }
  if (now - lastTelemMs >= TELEM_MS) {
    lastTelemMs = now;
    telemetryTick();
  }
  if (now - lastWdogMs >= WDOG_MS) {
    lastWdogMs = now;
    watchdog.feed();
  }
  Time.sleep(1);
}
