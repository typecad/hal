// ---------------------------------------------------------------------------
// main.ts — Async Environment Station (Black Pill, cooperative tasks)
//
// Modern typeCAD firmware style: no manual superloop — three async tasks
// await their cadences and the engine's static promise runtime pumps them.
//
//   sampler  — pot (PA1) → °C, EMA-smoothed, appended to a bounded history
//   alarmer  — hysteresis over the EMA; latches the peak while in alarm;
//              drives the LED; reports transitions once
//   reporter — one status line every REPORT_MS; the button forces a report
//
// The boot banner prints the chip revision + device ID read from
// DBGMCU_IDCODE (0xE0042004) through a @register bitfield class — the
// transpiler lowers field reads to masked loads of the mapped word.
// ---------------------------------------------------------------------------

import {
  GPIO, LED, BUTTON, PA1,
  ADC, UART, Time, Async, Watchdog,
  register, bits, Bit, Bits,
} from '@typecad/hal';

// ── Identity / tunables ────────────────────────────────────────────────────
const FW_VERSION = '3.1.0';

const SAMPLE_MS = 2000;
const ALARM_MS = 500;
const REPORT_MS = 10000;
const HISTORY_CAP = 12;

const MV_SPAN = 3300.0;
const C_SPAN = 100.0;
const C_OFFSET = -10.0;
const EMA_ALPHA = 0.3;

const ALARM_HIGH_C = 45.0;
const ALARM_LOW_C = 40.0;

// DBGMCU_IDCODE: bits [31:16] DEV_ID, [15:12] REV_ID slice we care about.
// Reads lower to a masked load of the mapped 32-bit word.
@register(0xE0042000)
class ChipId {
  @bits(11, 0)
  static rev: Bit = 0;

  @bits(15, 12)
  static revMinor: Bits<4> = 0;
}

// ── Hardware ───────────────────────────────────────────────────────────────
const console = new UART('UART0', { baud: 115200, rxBufferBytes: 96 });
const tempSense = new ADC(PA1);
const led = new GPIO(LED, GPIO.OUTPUT);
const button = new GPIO(BUTTON, GPIO.INPUT | GPIO.PULL_UP);

// ── Shared station state (tasks communicate through these) ────────────────
let tempC = 0.0;
let inAlarm = false;
let alarmPeak = 0.0;
let reports = 0;
let forceReport = false;

// Bounded history of recent EMA readings (oldest dropped via shift).
const history: number[] = [];

function pushHistory(v: number): void {
  history.push(v);
  while (history.length > HISTORY_CAP) {
    history.shift();
  }
}

function historyMin(): number {
  if (history.length === 0) {
    return 0.0;
  }
  let m = history[0];
  for (const v of history) {
    if (v < m) {
      m = v;
    }
  }
  return m;
}

function historyMax(): number {
  if (history.length === 0) {
    return 0.0;
  }
  let m = history[0];
  for (const v of history) {
    if (v > m) {
      m = v;
    }
  }
  return m;
}

// ── Task 1: sampler ────────────────────────────────────────────────────────
async function sampler(): Promise<void> {
  let first = true;
  while (true) {
    const mv = tempSense.readMillivolts();
    const rawC = (mv / MV_SPAN) * C_SPAN + C_OFFSET;
    if (first) {
      tempC = rawC;
      first = false;
    } else {
      tempC = tempC + EMA_ALPHA * (rawC - tempC);
    }
    pushHistory(tempC);
    await Time.sleep(SAMPLE_MS);
  }
}

// ── Task 2: alarmer (hysteresis + latched peak) ────────────────────────────
enum AlarmEvent { None, Raised, Cleared }

function alarmPass(): AlarmEvent {
  if (!inAlarm && tempC >= ALARM_HIGH_C) {
    inAlarm = true;
    alarmPeak = tempC;
    return AlarmEvent.Raised;
  }
  if (inAlarm) {
    if (tempC > alarmPeak) {
      alarmPeak = tempC;
    }
    if (tempC < ALARM_LOW_C) {
      inAlarm = false;
      return AlarmEvent.Cleared;
    }
  }
  return AlarmEvent.None;
}

async function alarmer(): Promise<void> {
  let wasPressed = false;
  while (true) {
    // Short button press forces a report (debounced by the 500 ms cadence).
    const pressed = button.get();
    if (pressed && !wasPressed) {
      forceReport = true;
    }
    wasPressed = pressed;

    const ev = alarmPass();
    if (ev === AlarmEvent.Raised) {
      led.set(true);
      console.writeLine(`[alm] raised — T=${tempC.toFixed(1)}C (limit ${ALARM_HIGH_C.toFixed(0)})`);
    } else if (ev === AlarmEvent.Cleared) {
      led.set(false);
      console.writeLine(`[alm] cleared — peak was ${alarmPeak.toFixed(1)}C`);
    }
    await Time.sleep(ALARM_MS);
  }
}

// ── Task 3: reporter ───────────────────────────────────────────────────────
function reportLine(): string {
  const lo = historyMin();
  const hi = historyMax();
  const state = inAlarm ? `ALARM(peak ${alarmPeak.toFixed(1)})` : 'ok';
  return `rep#${reports} T=${tempC.toFixed(1)}C win=[${lo.toFixed(1)}..${hi.toFixed(1)}] n=${history.length} ${state}`;
}

async function reporter(): Promise<void> {
  while (true) {
    if (forceReport) {
      forceReport = false;
    } else {
      // Wait the full interval, waking early only via the button flag —
      // polled in small slices so the forced report stays responsive.
      let waited = 0;
      while (waited < REPORT_MS && !forceReport) {
        await Time.sleep(250);
        waited += 250;
      }
    }
    reports += 1;
    console.writeLine(reportLine());
    await Async.yield();
  }
}

// ── Boot ───────────────────────────────────────────────────────────────────
console.writeLine(`[boot] async-station fw ${FW_VERSION}`);
console.writeLine(`[boot] chip rev=${ChipId.rev} revMinor=${ChipId.revMinor} (DBGMCU_IDCODE)`);

const watchdog = new Watchdog(2000);
watchdog.enable();
console.writeLine('[boot] tasks starting');

sampler();
alarmer();
reporter();
