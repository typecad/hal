// ---------------------------------------------------------------------------
// main.ts — Fan Controller firmware (Black Pill superloop)
//
// What a small shipped device actually is: a boot self-test, a calibrated
// config persisted in flash with a checksum, a cooperative tick scheduler
// over a table of task records, a debounced button, a filtered sensor, a
// hysteresis controller with slew-limited PWM, latched alarms, a serial
// command interpreter, and a watchdog. No RTOS threads — scheduled work.
//
//   pot (PA1) ~ temperature · PWM fan (PA8, 25 kHz) · LED (PC13) heartbeat
//   button (PA0): short = toggle auto/manual, long = clear alarms
//   console (UART0, 115200): help | status | get | set <k> <v> | save |
//                             defaults | alarms | clear
// ---------------------------------------------------------------------------

import {
  GPIO, LED, BUTTON, PA1, PA8,
  UART, ADC, PWM, Store, Time, Watchdog,
} from '@typecad/hal';

// ── Firmware identity / tunables ───────────────────────────────────────────
const FW_VERSION = '1.4.2';
const CFG_NS = 'ctrl';

const TICK_SLEEP_MS = 1;
const SAMPLE_MS = 10;
const CONTROL_MS = 100;
const TELEM_MS = 1000;
const WDOG_MS = 400;

const EMA_ALPHA = 0.2;
const DEBOUNCE_MS = 30;
const LONGPRESS_MS = 800;
const SLEW_PER_TICK = 0.05;
const OVERTEMP_C = 60.0;
const FAN_PWM_NS = 40000; // 25 kHz

// Sensor transfer: 0..3300 mV → -10..90 °C (mV-per-degree is compile-time).
const MV_SPAN = 3300.0;
const C_SPAN = 100.0;
const C_OFFSET = -10.0;

// ── Persistent, calibrated configuration ───────────────────────────────────
class Config {
  setpoint = 30.0;
  hysteresis = 1.5;
  calOffset = 0.0;
  minDuty = 0.15;
  maxDuty = 1.0;
  auto = true;

  private store = new Store(CFG_NS);

  /** Fold the fields into a checksum — a stale/corrupt flash image fails it. */
  checksum(): number {
    let sum = 0;
    sum += Math.round(this.setpoint * 7);
    sum += Math.round(this.hysteresis * 11);
    sum += Math.round(this.calOffset * 13);
    sum += Math.round(this.minDuty * 17);
    sum += Math.round(this.maxDuty * 19);
    sum += this.auto ? 23 : 29;
    return sum;
  }

  private clampFields(): void {
    this.setpoint = Math.min(Math.max(this.setpoint, 0.0), 50.0);
    this.hysteresis = Math.min(Math.max(this.hysteresis, 0.1), 10.0);
    this.calOffset = Math.min(Math.max(this.calOffset, -5.0), 5.0);
    this.minDuty = Math.min(Math.max(this.minDuty, 0.0), 1.0);
    this.maxDuty = Math.min(Math.max(this.maxDuty, this.minDuty), 1.0);
  }

  /** Load from flash; fall back to factory defaults when absent or corrupt. */
  load(): string {
    const crc = this.store.getInt('crc', -1);
    this.setpoint = this.store.getFloat('setpoint', 30.0);
    this.hysteresis = this.store.getFloat('hysteresis', 1.5);
    this.calOffset = this.store.getFloat('calOffset', 0.0);
    this.minDuty = this.store.getFloat('minDuty', 0.15);
    this.maxDuty = this.store.getFloat('maxDuty', 1.0);
    this.auto = this.store.getBool('auto', true);
    if (crc !== this.checksum()) {
      this.factory();
      return 'defaults';
    }
    this.clampFields();
    return 'ok';
  }

  save(): void {
    this.clampFields();
    this.store.setFloat('setpoint', this.setpoint);
    this.store.setFloat('hysteresis', this.hysteresis);
    this.store.setFloat('calOffset', this.calOffset);
    this.store.setFloat('minDuty', this.minDuty);
    this.store.setFloat('maxDuty', this.maxDuty);
    this.store.setBool('auto', this.auto);
    this.store.setInt('crc', this.checksum());
  }

  factory(): void {
    this.setpoint = 30.0;
    this.hysteresis = 1.5;
    this.calOffset = 0.0;
    this.minDuty = 0.15;
    this.maxDuty = 1.0;
    this.auto = true;
  }
}

// ── Device state machine ───────────────────────────────────────────────────
enum DevState { Boot, Idle, Running, Fault }

function stateName(s: DevState): string {
  switch (s) {
    case DevState.Boot: return 'BOOT';
    case DevState.Idle: return 'IDLE';
    case DevState.Running: return 'RUN';
    case DevState.Fault: return 'FAULT';
    default: return '?';
  }
}

// ── Latched alarms (name → first-seen uptime ms) ───────────────────────────
const alarms = new Map<string, number>();
let lastAlarm = '-';

function raiseAlarm(name: string): void {
  if (!alarms.has(name)) {
    alarms.set(name, Time.now());
    lastAlarm = name;
    console.writeLine(`[ALM] ${name} @ ${uptimeText()}`);
  }
}

function alarmCount(): number {
  return alarms.size;
}

// ── Hardware ───────────────────────────────────────────────────────────────
const console = new UART('UART0', { baud: 115200, rxBufferBytes: 128 });
const sensor = new ADC(PA1);
const fan = new PWM(PA8, { periodNs: FAN_PWM_NS });
const led = new GPIO(LED, GPIO.OUTPUT);
const button = new GPIO(BUTTON, GPIO.INPUT | GPIO.PULL_UP);

// ── Sensor path: mV → °C → EMA ─────────────────────────────────────────────
class LowPass {
  private primed = false;
  private value = 0.0;

  update(x: number): number {
    if (!this.primed) {
      this.primed = true;
      this.value = x;
    } else {
      this.value = this.value + EMA_ALPHA * (x - this.value);
    }
    return this.value;
  }

  get current(): number {
    return this.primed ? this.value : 0.0;
  }
}

const filter = new LowPass();
let tempC = 0.0;

function sampleSensor(): void {
  const mv = sensor.readMillivolts();
  const rawC = (mv / MV_SPAN) * C_SPAN + C_OFFSET + cfg.calOffset;
  tempC = filter.update(rawC);
}

// ── Button: debounce + short/long press ────────────────────────────────────
enum PressAction { None, Short, Long }

class Debouncer {
  private stable = true;
  private lastEdgeMs = 0;
  private downMs = 0;
  private longFired = false;

  feed(raw: boolean, now: number): PressAction {
    if (raw !== this.stable) {
      if (now - this.lastEdgeMs >= DEBOUNCE_MS) {
        this.stable = raw;
        this.lastEdgeMs = now;
        if (!raw) {
          this.downMs = now;
          this.longFired = false;
        }
      }
    }
    if (!this.stable && !this.longFired && now - this.downMs >= LONGPRESS_MS) {
      this.longFired = true;
      return PressAction.Long;
    }
    if (this.stable && !this.longFired && this.downMs > 0 && now - this.downMs >= DEBOUNCE_MS) {
      const held = now - this.downMs;
      this.downMs = 0;
      if (held < LONGPRESS_MS) {
        return PressAction.Short;
      }
    }
    return PressAction.None;
  }
}

const debouncer = new Debouncer();

function pollButton(): void {
  const action = debouncer.feed(button.get(), Time.now());
  if (action === PressAction.Short) {
    cfg.auto = !cfg.auto;
    console.writeLine(`auto=${cfg.auto ? 'on' : 'off'} (duty ${dutyTarget.toFixed(2)})`);
  } else if (action === PressAction.Long) {
    alarms.clear();
    lastAlarm = '-';
    console.writeLine('alarms cleared');
  }
}

// ── Control: hysteresis + slew-limited duty ────────────────────────────────
let state: DevState = DevState.Boot;
let dutyNow = 0.0;
let dutyTarget = 0.0;

function controlTick(): void {
  // Fault latches until a manual clear.
  if (tempC >= OVERTEMP_C) {
    state = DevState.Fault;
    raiseAlarm('overtemp');
  }

  switch (state) {
    case DevState.Boot:
    case DevState.Idle:
      dutyTarget = 0.0;
      if (tempC > cfg.setpoint + cfg.hysteresis) {
        state = DevState.Running;
      }
      break;
    case DevState.Running:
      if (tempC < cfg.setpoint - cfg.hysteresis) {
        state = DevState.Idle;
        dutyTarget = 0.0;
      } else {
        // Proportional-in-the-band fan curve, clamped to the configured range.
        const over = tempC - cfg.setpoint;
        const band = Math.max(cfg.hysteresis * 2.0, 0.5);
        const frac = Math.min(Math.max(over / band, 0.0), 1.0);
        dutyTarget = cfg.minDuty + frac * (cfg.maxDuty - cfg.minDuty);
      }
      break;
    case DevState.Fault:
      dutyTarget = 1.0; // fail safe: full fan
      break;
    default:
      break;
  }

  if (!cfg.auto) {
    // Manual mode holds the last commanded duty — only the button changes it.
    dutyTarget = dutyNow > 0.0 ? dutyNow : cfg.minDuty;
  }

  // Slew limit toward the target so the fan does not audibly step.
  if (dutyNow < dutyTarget) {
    dutyNow = Math.min(dutyNow + SLEW_PER_TICK, dutyTarget);
  } else if (dutyNow > dutyTarget) {
    dutyNow = Math.max(dutyNow - SLEW_PER_TICK, dutyTarget);
  }
  fan.setDuty(dutyNow);
}

// ── Console: line assembler + command interpreter ──────────────────────────
// Printable ASCII 0x20..0x7E as one literal — a byte indexes into it without
// any runtime char-code conversion (String.fromCharCode is not lowered).
const PRINTABLE = ' !"#$%&\'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_`abcdefghijklmnopqrstuvwxyz{|}~';

class LineReader {
  private buf = '';

  /** Feed one byte; returns the completed line on CR/LF, else null. */
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

function pollConsole(): void {
  while (console.available() > 0) {
    const line = reader.feed(console.read());
    if (line !== null) {
      handleLine(line);
    }
  }
}

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
  const cmd = parts[0].toLowerCase();
  switch (cmd) {
    case 'help':
      console.writeLine(`fw ${FW_VERSION} — status get set save defaults alarms clear`);
      break;
    case 'status':
      console.writeLine(
        `${uptimeText()} ${stateName(state)} T=${tempC.toFixed(1)}C duty=${(dutyNow * 100).toFixed(0)}% ` +
        `sp=${cfg.setpoint.toFixed(1)} hyst=${cfg.hysteresis.toFixed(1)} cal=${cfg.calOffset.toFixed(2)} ` +
        `auto=${cfg.auto ? 'on' : 'off'} alms=${alarmCount()} last=${lastAlarm}`
      );
      break;
    case 'get':
      console.writeLine(
        `setpoint=${cfg.setpoint.toFixed(1)} hysteresis=${cfg.hysteresis.toFixed(1)} ` +
        `calOffset=${cfg.calOffset.toFixed(2)} minDuty=${cfg.minDuty.toFixed(2)} ` +
        `maxDuty=${cfg.maxDuty.toFixed(2)} auto=${cfg.auto ? '1' : '0'}`
      );
      break;
    case 'set': {
      if (parts.length < 3) {
        console.writeLine('usage: set <key> <value>');
        return;
      }
      const value = parseFloat(parts[2]);
      if (value !== value) { // NaN — the bare-metal check (no Number.*)
        console.writeLine(`bad value '${parts[2]}'`);
        return;
      }
      applySet(parts[1].toLowerCase(), value);
      console.writeLine(`${parts[1]}=${value} (save to persist)`);
      return;
    }
    case 'save':
      cfg.save();
      console.writeLine(`saved crc=${cfg.checksum()}`);
      break;
    case 'defaults':
      cfg.factory();
      cfg.save();
      console.writeLine('factory defaults restored + saved');
      break;
    case 'alarms':
      if (alarmCount() === 0) {
        console.writeLine('no alarms');
      } else {
        console.writeLine(`${alarmCount()} alarm(s), last=${lastAlarm}`);
      }
      break;
    case 'clear':
      alarms.clear();
      lastAlarm = '-';
      console.writeLine('alarms cleared');
      break;
    default:
      console.writeLine(`unknown command '${cmd}' (try help)`);
      break;
  }
}

function applySet(key: string, value: number): void {
  switch (key) {
    case 'setpoint': cfg.setpoint = value; break;
    case 'hysteresis': cfg.hysteresis = value; break;
    case 'caloffset': cfg.calOffset = value; break;
    case 'minduty': cfg.minDuty = value; break;
    case 'maxduty': cfg.maxDuty = value; break;
    default:
      console.writeLine(`unknown key '${key}'`);
      break;
  }
}

// ── Telemetry + heartbeat ──────────────────────────────────────────────────
let heartbeats = 0;

function telemetryTick(): void {
  heartbeats += 1;
  led.set(heartbeats % 2 === 0);
  console.writeLine(
    `[tel] ${uptimeText()} ${stateName(state)} T=${tempC.toFixed(1)} duty=${(dutyNow * 100).toFixed(0)}%`
  );
}

// ── Boot: self-test, config, watchdog ──────────────────────────────────────
const cfg = new Config();

console.writeLine(`[boot] fan-controller fw ${FW_VERSION}`);
console.writeLine(`[boot] config: ${cfg.load()}`);

{
  // Self-test: three LED blips + a fan kick, then quiesce.
  for (let i = 0; i < 3; i += 1) {
    led.set(false);
    Time.sleep(60);
    led.set(true);
    Time.sleep(60);
  }
  fan.setDuty(0.5);
  Time.sleep(200);
  fan.setDuty(0.0);
}

const watchdog = new Watchdog(WDOG_MS * 4);
watchdog.enable();
console.writeLine('[boot] selftest ok, watchdog armed, entering superloop');

// ── The superloop: schedule each task when its interval elapses ────────────
type Task = { name: string; everyMs: number; last: number; run: () => void };

const tasks: Task[] = [
  { name: 'sample', everyMs: SAMPLE_MS, last: 0, run: (): void => { sampleSensor(); } },
  { name: 'button', everyMs: SAMPLE_MS, last: 0, run: (): void => { pollButton(); } },
  { name: 'console', everyMs: SAMPLE_MS, last: 0, run: (): void => { pollConsole(); } },
  { name: 'control', everyMs: CONTROL_MS, last: 0, run: (): void => { controlTick(); } },
  { name: 'telemetry', everyMs: TELEM_MS, last: 0, run: (): void => { telemetryTick(); } },
  { name: 'watchdog', everyMs: WDOG_MS, last: 0, run: (): void => { watchdog.feed(); } },
];

while (true) {
  const now = Time.now();
  for (let i = 0; i < tasks.length; i += 1) {
    const t = tasks[i];
    if (now - t.last >= t.everyMs) {
      t.last = now;
      t.run();
    }
  }
  Time.sleep(TICK_SLEEP_MS);
}
