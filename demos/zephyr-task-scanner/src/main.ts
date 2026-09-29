// ---------------------------------------------------------------------------
// main.ts — task scanner (Black Pill + console UART + pot + button)
//
// A cooperative scheduler simulation: a fixed table of Task records; every
// pass scans the table (continue skips tasks that can't run), and a
// do-while retry loop re-enters a task's step until its budget is consumed
// or it reports done (break). The run ledger is a Set<string>; the report
// walks it. The pot biases task selection, the button forces a pass.
// ---------------------------------------------------------------------------

import {
  GPIO, LED, BUTTON, PA1,
  ADC, UART0,
  Time, Trace,
} from '@typecad/hal';

// ── Tunables ───────────────────────────────────────────────────────────────
const PASS_INTERVAL_MS = 3000;
const STEP_BUDGET = 3;
const DONE_AFTER = 4;

type Task = {
  name: string;
  weight: number;
  runs: number;
  progress: number;
  done: boolean;
};

/** Make one step of progress; false when the task wants no more steps. */
function step(t: Task): boolean {
  t.runs += 1;
  t.progress += t.weight;
  return t.progress < 100;
}

/** Simulated work: each step burns a deterministic pseudo-load. */
function load(seed: number): number {
  let x = seed;
  do {
    x = (x * 7 + 3) % 13;
  } while (x > 6);
  return x;
}

// ── Hardware ───────────────────────────────────────────────────────────────
const pot = new ADC(PA1);
const led = new GPIO(LED, GPIO.OUTPUT);
const button = new GPIO(BUTTON, GPIO.INPUT | GPIO.PULL_UP);

let forced = false;
button.onInterrupt(GPIO.INT_EDGE_FALLING, () => {
  forced = true;
});

// ── Scheduler state ────────────────────────────────────────────────────────
const table: Task[] = [
  { name: 'sense', weight: 9, runs: 0, progress: 0, done: false },
  { name: 'filter', weight: 25, runs: 0, progress: 0, done: false },
  { name: 'report', weight: 50, runs: 0, progress: 0, done: false },
];
const finished = new Set<string>();
// Set iteration is not lowered — the documented idiom is a parallel key
// array kept alongside for reporting.
const doneNames: string[] = [];

/** One scheduling pass: scan the table, run steps within budgets. */
function runPass(bias: number): number {
  let steps = 0;
  for (const t of table) {
    // Done tasks leave the rotation entirely.
    if (t.done) {
      continue;
    }
    // Weight gates the task this pass unless the bias overrides it.
    if (t.weight > bias && steps > 0) {
      continue;
    }
    // do-while: run at least one step, retry while budget remains and the
    // task wants more; break early on completion.
    let budget = STEP_BUDGET;
    do {
      const wants = step(t);
      steps += 1;
      if (!wants) {
        t.done = true;
        if (!finished.has(t.name)) {
          finished.add(t.name);
          doneNames.push(t.name);
        }
        break;
      }
      budget -= 1;
      if (budget === 0) {
        break;
      }
    } while (t.progress < 100);
  }
  return steps;
}

/** Ledger report: finished names, then per-task progress bars. */
function report(): string {
  let line = `done=[${doneNames.join(',')}]`;
  for (const t of table) {
    const cells = Math.min(10, Math.round(t.progress / 10));
    let bar = '';
    for (let i = 0; i < 10; i += 1) {
      bar += i < cells ? '#' : '.';
    }
    line += ` | ${t.name}:${bar}${t.done ? ' ✓' : ''}`;
  }
  return line;
}

UART0.writeLine('[boot] task-scanner up — button forces a pass');

let passes = 0;
let lastPass = Time.now();

while (true) {
  const mv = pot.readMillivolts();
  // Bias: low pot voltage admits heavy tasks sooner.
  const bias = 10 + Math.round(mv / 330);

  if (forced || Time.now() - lastPass >= PASS_INTERVAL_MS) {
    forced = false;
    lastPass = Time.now();
    Trace.mark('pass');
    const steps = runPass(bias);
    passes += 1;
    UART0.writeLine(`pass#${passes} bias=${bias} steps=${steps}`);
    UART0.writeLine(report());
    if (finished.size === table.length) {
      UART0.writeLine('[done] all tasks complete — resetting');
      finished.clear();
      doneNames.length = 0;
      for (const t of table) {
        t.runs = 0;
        t.progress = 0;
        t.done = false;
      }
    }
  }

  led.set(passes % 2 === 1);
  Time.sleep(50);
}
