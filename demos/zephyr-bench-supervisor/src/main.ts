// ---------------------------------------------------------------------------
// main.ts — bench supervisor (Black Pill + console UART + pot + watchdog)
//
// The PA1 pot streams samples into an 8-bucket histogram; an alarm fires
// (Trace event + elog entry) when the reading crosses the configurable level.
// Console commands arrive on UART0 RX: D dumps the event elog, C clears it,
// L <mv> retunes the alarm level, H prints the command table. The KEY button
// dumps the elog without the console. A hardware watchdog arms the loop and a
// heartbeat thread blinks the LED. Everything the console prints rides the
// Sink interface so the command handlers stay hardware-free.
// ---------------------------------------------------------------------------

import {
  GPIO, LED, BUTTON, PA1,
  ADC, UART0,
  Watchdog, Trace, Time, Thread,
} from '@typecad/hal';
import {
  Verb, Severity, severityLabel,
  Sink, Command,
  LineAssembler, EventLog, Histogram,
  CommandHandler, DumpHandler, ClearHandler, LevelHandler, HelpHandler,
} from './console.js';

// ── Tunables ───────────────────────────────────────────────────────────────
const REPORT_EVERY_MS = 15000;
const ALARM_DEFAULT_MV = 2750;
const SAMPLE_PERIOD_MS = 50;

// ── Hardware handles ───────────────────────────────────────────────────────
const pot = new ADC(PA1);
const led = new GPIO(LED, GPIO.OUTPUT);
const button = new GPIO(BUTTON, GPIO.INPUT | GPIO.PULL_UP);
const wdt = new Watchdog(8000);

// Button presses arrive from interrupt context as a flag only.
let buttonPressed = false;
button.onInterrupt(GPIO.INT_EDGE_FALLING, () => {
  buttonPressed = true;
});

// ── Heartbeat thread — LED blink, independent of the supervisor loop ───────
const heartbeat = new Thread(0, { stackKb: 1 });
heartbeat.start(() => {
  while (true) {
    led.toggle();
    Time.sleep(250);
  }
});

// ── Supervisor state ───────────────────────────────────────────────────────
const elog = new EventLog(16);
const hist = new Histogram(3300);
const assembler = new LineAssembler(48);

// The console writes through a tiny sink — keeps console.ts hardware-free.
class UartSink implements Sink {
  writeLine(s: string): void {
    UART0.writeLine(s);
  }
}
const out = new UartSink();

const dumpHandler = new DumpHandler(elog, out);
const levelHandler = new LevelHandler(ALARM_DEFAULT_MV, out);
const handlers = new Map<number, CommandHandler>();
handlers.set(Verb.Dump, dumpHandler);
handlers.set(Verb.Clear, new ClearHandler(elog, out));
handlers.set(Verb.Level, levelHandler);
handlers.set(Verb.Help, new HelpHandler(out));
const fallbackHandler = new HelpHandler(out);

UART0.writeLine(`[boot] bench-supervisor ready — ${handlers.size} commands, level=${ALARM_DEFAULT_MV}mV`);

wdt.enable();
elog.record(Severity.Info, 0, Time.now());

let lastReport = Time.now();
let samples = 0;

while (true) {
  wdt.feed();

  // ── Console RX: assemble bytes, dispatch completed commands ──────────────
  while (UART0.available() > 0) {
    const cmd: Command = assembler.feed(UART0.read());
    if (cmd.verb === Verb.None) {
      if (!cmd.ok) {
        out.writeLine(`? unknown command code=${cmd.arg.toString(16)} — try H`);
        elog.record(Severity.Warn, 1, Time.now());
      }
      continue;
    }
    Trace.mark('cmd');
    const handler = handlers.get(cmd.verb) ?? fallbackHandler;
    handler.run(cmd.arg);
    if (cmd.verb === Verb.Level) {
      Trace.event('level', levelHandler.level);
    }
    elog.record(Severity.Info, cmd.verb, Time.now());
  }

  // ── Button press dumps the elog without the console ───────────────────────
  if (buttonPressed) {
    buttonPressed = false;
    Trace.mark('button-dump');
    dumpHandler.run(0);
  }

  // ── Pot sample: histogram + threshold alarm ──────────────────────────────
  const mv = pot.readMillivolts();
  hist.add(mv);
  samples += 1;
  if (mv >= levelHandler.level) {
    Trace.event('mv', mv);
    elog.record(Severity.Warn, 2, Time.now());
    out.writeLine(`[alarm] ${mv.toFixed(0)}mV >= ${levelHandler.level.toFixed(0)}mV (${severityLabel(Severity.Warn)})`);
    Time.sleep(750);
  }

  // ── Periodic report: histogram bar, counters, newest events ──────────────
  if (Time.now() - lastReport >= REPORT_EVERY_MS) {
    lastReport = Time.now();
    out.writeLine(`── report: samples=${samples.toFixed(0)} peak=${hist.peak.toFixed(0)} ──`);
    out.writeLine(`hist [${hist.bar()}] alarm>=${levelHandler.level.toFixed(0)}mV`);
    out.writeLine(`events ${elog.count('INFO')}/${elog.count('WARN')}/${elog.count('FAULT')} (I/W/F)`);
    const shown = elog.size < 4 ? elog.size : 4;
    for (let i = 0; i < shown; i += 1) {
      out.writeLine(elog.at(i).line());
    }
  }

  Time.sleep(SAMPLE_PERIOD_MS);
}
