// ---------------------------------------------------------------------------
// main.ts — sentence shell over the USB CDC console (Black Pill).
//
// New surface for round 3: USB0 (CDC), the File store (littlefs), an async
// boot sequence (await Async.sleep), and — deliberately — a variable named
// `log` (a reserved libc name) holding the File instance, re-exercising the
// rename/tree-shaking machinery on a HAL-class shape. The string-heavy
// protocol lives in proto.ts; this file is wiring and the command loop.
// ---------------------------------------------------------------------------

import {
  GPIO, LED, BUTTON,
  USB0, File,
  Time, Thread,
} from '@typecad/hal';
import {
  CmdKind, cmdName, checksum, hex2, buildSentence,
  Sentence, Settings, TerseFormatter, VerboseFormatter, ReplyFormatter,
  applySentence,
} from './proto.js';

const SETTINGS_PATH = 'session.cfg';
const BOOT_BANNER_MS = 40;
const STATS_EVERY = 6;

// `log` is a reserved libc name — this exercises the escape end to end on a
// HAL-class instance (File): declaration and every reference render as log_.
const log = new File(SETTINGS_PATH);
const cfg = new Settings();
const fmt: ReplyFormatter = new TerseFormatter();
const verbose = new VerboseFormatter();

// Button presses arrive from interrupt context as a flag only.
let dumpRequested = false;
const button = new GPIO(BUTTON, GPIO.INPUT | GPIO.PULL_UP);
button.onInterrupt(GPIO.INT_EDGE_FALLING, () => {
  dumpRequested = true;
});

// ── Heartbeat thread — LED blink while the shell runs ──────────────────────
const heartbeat = new Thread(0, { stackKb: 1 });
heartbeat.start(() => {
  const led = new GPIO(LED, GPIO.OUTPUT);
  while (true) {
    led.toggle();
    Time.sleep(250);
  }
});

// ── Async boot: banner paced so the host CDC settles ───────────────────────
// The settings load happens at the CALL SITE (hoisted out of the async fn —
// async-task locals/params are currently not threaded into the task class —
// the boot is pure pacing; the load + keys line run at the top level).
async function boot(): Promise<void> {
  USB0.writeLine(buildSentence(['BOOT', 'shell-logger']));
  await Time.sleep(BOOT_BANNER_MS);
  await Time.sleep(BOOT_BANNER_MS);
}

// ── Line assembler over the CDC byte stream ────────────────────────────────
// Byte → char through an explicit printable-ASCII table (the registry's
// recommended form — String.fromCharCode has no lowering). The sentence
// grammar is entirely printable, so anything else is dropped.
const PRINTABLE = " !\"#$%&'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_`abcdefghijklmnopqrstuvwxyz{|}~";
let rxbuf = '';
function feedByte(b: number): string {
  if (b === 13 || b === 10) {
    const line = rxbuf.trim();
    rxbuf = '';
    return line;
  }
  if (b >= 32 && b <= 126 && rxbuf.length < 96) {
    rxbuf += PRINTABLE.charAt(b - 32);
  }
  return '';
}

const saved: string = log.read();
const loaded = cfg.load(saved);
await boot();
USB0.writeLine(buildSentence(['BOOT', 'keys', loaded.toFixed(0)]));

let handled = 0;
let badChecksum = 0;

while (true) {
  while (true) {
    const b = USB0.read();
    if (b < 0) {
      break;
    }
    const line = feedByte(b);
    if (line.length === 0) {
      continue;
    }
    const s = new Sentence(line);
    if (!s.valid) {
      badChecksum += 1;
      USB0.writeLine(fmt.err('cs:' + hex2(checksum(line))));
      continue;
    }
    if (s.kind === CmdKind.List) {
      let out = '';
      for (const p of cfg.pairs()) {
        out += p;
        out += ';';
      }
      USB0.writeLine(buildSentence(['LST', out]));
    } else if (s.kind === CmdKind.Clear && s.fields.length === 1) {
      cfg.load('');
      USB0.writeLine(buildSentence(['CLR', 'all']));
    } else {
      const r = applySentence(cfg, s);
      USB0.writeLine(r.ok ? fmt.ok(r.key, r.value) : verbose.err(r.why));
    }
    handled += 1;
    if (handled % STATS_EVERY === 0) {
      // Parts hoisted: a concat inside an array literal currently renders
      // as raw `const char* + double` — statement-level concats lower fine.
      const okPart = `ok=${handled}`;
      const badPart = `bad=${badChecksum}`;
      const keysPart = `keys=${cfg.size.toFixed(0)}`;
      USB0.writeLine(buildSentence(['STAT', okPart, badPart, keysPart]));
    }
  }

  if (dumpRequested) {
    dumpRequested = false;
    const text: string = log.read();
    const chars = text.trim().length;
    USB0.writeLine(buildSentence(['DUMP', chars.toFixed(0)]));
  }

  // Persist the settings whenever the write budget allows (every pass for
  // this bench demo — the file is tiny).
  log.write(cfg.serialize());

  Time.sleep(20);
}
