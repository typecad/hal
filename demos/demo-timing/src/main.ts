// ---------------------------------------------------------------------------
// main.ts — the Time API showcase (Seeed XIAO nRF52840)
//
// The TS-flavored timing surface on hardware:
//   Time.sleep(ms)    — yielding sleep (k_msleep); the loop idiom
//   Time.now()        — milliseconds since boot, double, no uint32 wrap
//   Time.nowUs()      — the microsecond clock
//   Time.busyWaitUs() — cooperative spin (k_busy_wait), no yield
//   Thread            — real kernel threads (k_thread_create) running the LED
//                       blink and the beat logger OFF the main loop
//
// Top-level statements lower into main(); the program ends on blinker.join()
// (K_FOREVER — the threads run forever, keeping the firmware alive).
// ---------------------------------------------------------------------------

import { LED, USB0 } from '@typecad/board';
import { GPIO, Time, Thread } from '@typecad/hal';

const led = new GPIO(LED, GPIO.OUTPUT);

// USB CDC serial on the XIAO's USB-C connector — the report channel for the
// clocks below. Output before the host opens the port is dropped, so the
// beat logger gates on linked().
USB0.open();

// ── 1. Clocks ─────────────────────────────────────────────────────────────
const boot: number = Time.now();
if (USB0.linked()) {
  USB0.writeLine(`boot at ${boot} ms, us clock reads ${Time.nowUs()}`);
}

// ── 2. A kernel thread blinks the LED concurrently with main ─────────────
const blinker = new Thread(0, { stackKb: 4, priority: 5 });
blinker.start((): void => {
  while (true) {
    led.toggle();
    Time.sleep(250);        // yields the thread — main keeps running
  }
});

// ── 3. A second thread logs a beat every second while main sleeps ─────────
const logger = new Thread(1, { stackKb: 4, priority: 5 });
logger.start((): void => {
  let beats: number = 0;
  const started: number = Time.now();
  while (true) {
    beats = beats + 1;
    if (USB0.linked()) {
      USB0.writeLine(`beat ${beats} @ ${Time.now() - started} ms since start`);
    }
    Time.sleep(1000);
  }
});

// ── 4. The microsecond spin — no yield, for sub-ms protocol timing ───────
Time.busyWaitUs(10);

// Main parks on the join: K_FOREVER, since the blinker never exits.
blinker.join();
