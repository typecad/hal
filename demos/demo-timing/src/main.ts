// ---------------------------------------------------------------------------
// main.ts — the Time API showcase (Seeed XIAO nRF52840)
//
// The TS-flavored timing surface on hardware:
//   Time.sleep(ms)    — yielding sleep (k_msleep); the loop idiom
//   Time.now()        — milliseconds since boot, double, no uint32 wrap
//   Time.nowUs()      — the microsecond clock
//   Time.busyWaitUs() — cooperative spin (k_busy_wait), no yield
//   setInterval       — plain JS names (k_timer + k_work underneath)
//   Thread            — a real kernel thread (k_thread_create) running the
//                       LED blink OFF the main loop, joined at the end
//
// Top-level statements lower into main(); the program ends on blinker.join()
// (K_FOREVER — the thread blinks forever, keeping the firmware alive).
// ---------------------------------------------------------------------------

import { LED } from '@typecad/board';
import { GPIO, Time, Thread, setInterval } from '@typecad/hal';

const led = new GPIO(LED, GPIO.OUTPUT);

// ── 1. Clocks ─────────────────────────────────────────────────────────────
const boot: number = Time.now();
console.log(`boot at ${boot} ms, us clock reads ${Time.nowUs()}`);

// ── 2. A kernel thread blinks the LED concurrently with main ─────────────
const blinker = new Thread(0, { stackKb: 4, priority: 5 });
blinker.start((): void => {
  while (true) {
    led.toggle();
    Time.sleep(250);        // yields the thread — main keeps running
  }
});

// ── 3. setInterval is plain JS (k_timer underneath), firing while main sleeps
let beats: number = 0;
setInterval((): void => {
  beats = beats + 1;
  console.log(`beat ${beats} @ ${Time.now() - boot} ms since boot`);
}, 1000);

// ── 4. The microsecond spin — no yield, for sub-ms protocol timing ───────
Time.busyWaitUs(10);

// Main parks on the join: K_FOREVER, since the blinker never exits.
blinker.join();
