// ---------------------------------------------------------------------------
// main.ts — climate fan bench (Black Pill + SHT30 + PWM fan)
//
// SHT30 on I2C0 (0x44) is sampled once a second; an 8-sample ring mean feeds
// a PID whose correction rides around a mid-scale duty on the PB6 fan (25 kHz
// PWM). The PA1 pot trims the setpoint ±3 °C. KEY cycles OFF → AUTO → BOOST
// → MANUAL (interrupt sets a flag; the main loop does the work, ISR-safe).
// Mode persists across re-flashing in the 'climate' settings store. A
// heartbeat thread blinks the LED so the two-thread lowering is exercised.
// ---------------------------------------------------------------------------

import {
  GPIO, LED, BUTTON, PA1, PB6,
  ADC, PWM, I2C0, UART0,
  Sensor, SENSOR, CHAN,
  Store, Time, Thread,
} from '@typecad/hal';
import { FanMode, nextMode, modeLabel, RingStats, Pid, BandThreshold } from './control.js';

// ── Tunables ───────────────────────────────────────────────────────────────
const SAMPLE_PERIOD_MS = 1000;
const SETPOINT_BASE_C = 28.0;
const POT_SPAN_C = 6.0;        // ±3 °C across the pot's travel
const MANUAL_DUTY = 0.35;
const ALARM_FLOOR_C = -5.0;
const ALARM_CEILING_C = 55.0;
const REPORT_EVERY = 5;        // status line cadence, in samples

// ── Hardware handles ───────────────────────────────────────────────────────
const fan = new PWM(PB6, { periodNs: 40_000 });   // 25 kHz, 4-wire fan style
const pot = new ADC(PA1);
const sht30 = new Sensor(SENSOR.sensirion_sht3xd, I2C0.device(0x44));
const led = new GPIO(LED, GPIO.OUTPUT);
const button = new GPIO(BUTTON, GPIO.INPUT | GPIO.PULL_UP);
const settings = new Store('climate');

// ── Controller state ───────────────────────────────────────────────────────
let mode: FanMode = settings.getInt('mode', FanMode.Auto);
const pid = Pid.bench();
const temps = new RingStats(8);
const alarm = new BandThreshold(ALARM_FLOOR_C, ALARM_CEILING_C);

// Button presses arrive from interrupt context as a flag only.
let buttonEvent = false;
button.onInterrupt(GPIO.INT_EDGE_FALLING, () => {
  buttonEvent = true;
});

// ── Heartbeat thread — LED blink, independent of the sampler's cadence ─────
const heartbeat = new Thread(0, { stackKb: 1 });
heartbeat.start(() => {
  while (true) {
    led.toggle();
    Time.sleep(250);
  }
});

// ── Sampler / controller loop ──────────────────────────────────────────────
UART0.writeLine(`[boot] climate-fan — mode=${modeLabel(mode)} pid-built=${Pid.constructed}`);

let lastMs = Time.now();
let seq = 0;

while (true) {
  const nowMs = Time.now();
  const dtSec = (nowMs - lastMs) / 1000.0;
  lastMs = nowMs;

  // Mode cycling happens in the main flow (the ISR only sets the flag).
  if (buttonEvent) {
    buttonEvent = false;
    mode = nextMode(mode);
    settings.setInt('mode', mode);
    pid.reset();
    UART0.writeLine(`[mode] ${modeLabel(mode)} (pid reset, integral was ${pid.integral})`);
  }

  // Sense: one SHT30 fetch, filtered through the ring window.
  sht30.fetch();
  const tempC = sht30.get(CHAN.AMBIENT_TEMP);
  temps.push(tempC);
  const filteredC = temps.celsius();

  // The pot (0–3300 mV) centers at mid-travel and trims the setpoint.
  const potMv = pot.readMillivolts();
  const setpointC = SETPOINT_BASE_C + ((potMv - 1650.0) / 3300.0) * POT_SPAN_C;

  // Act: mode selects the duty source. The fan cools, so a hot reading
  // (negative error) must push duty UP — hence the subtraction.
  let duty = 0.0;
  switch (mode) {
    case FanMode.Off:
      duty = 0.0;
      break;
    case FanMode.Boost:
      duty = 1.0;
      break;
    case FanMode.Manual:
      duty = MANUAL_DUTY;
      break;
    case FanMode.Auto:
    default:
      duty = 0.5 - pid.step(setpointC, filteredC, dtSec);
      break;
  }
  if (duty < 0.0) {
    duty = 0.0;
  }
  if (duty > 1.0) {
    duty = 1.0;
  }
  fan.setDuty(duty);

  // Alarm on band exits; report on entry only.
  if (alarm.update(tempC)) {
    UART0.writeLine(`[alarm] temp=${tempC}C left the ${ALARM_FLOOR_C}..${ALARM_CEILING_C} band (window spread ${temps.spread()})`);
  }

  seq += 1;
  if (seq % REPORT_EVERY === 0) {
    UART0.writeLine(
      `t=${tempC.toFixed(2)}C avg=${filteredC.toFixed(2)}C set=${setpointC.toFixed(1)}C ` +
      `duty=${(duty * 100).toFixed(0)}% mode=${modeLabel(mode)}`,
    );
  }

  Time.sleep(SAMPLE_PERIOD_MS);
}
