// Wake-report-sleep: one serial burst every cycle, microamps between.
//
// Each boot: read the wake counter from Store (flash-backed — RAM dies
// with soft-off, the settings area does not), increment, report it with
// the wall clock, stay awake 2 s, then offFor(5000) — soft-off with the
// RTC timer armed. Watch COM9: a burst every ~5 s, each one wake N+1.

import { Clock, Power, Store, Time, UART0 } from '@typecad/hal';

const store = new Store('wake');

let wakes = store.getInt('count', 0);
wakes = wakes + 1;
store.setInt('count', wakes);

// Wall-clock honesty (v1): the counter-shim's epoch offset lives in RAM,
// which soft-off does not retain — the RTC-domain counter keeps ticking
// through the sleep, but the offset dies with it. So stamp per wake (the
// real-world pattern: take the time from a server/GPS on each wake; or
// from the build host here). NVMEM-backed offset persistence
// (CONFIG_RTC_COUNTER_NVMEM) is the follow-up.
Clock.set(1710000000);

// (Two writes: the template-literal formatter infers %d for hal-expr
// values — a renderer gap worth fixing; the double writeLine path is
// correct today.)
UART0.writeLine(`wake ${wakes} at epoch:`);
UART0.writeLine(Clock.now());

// Two seconds of useful work (read sensors, publish...) — here, a notice.
Time.sleep(1500);
UART0.writeLine('sleeping 5s');
Time.sleep(500);

Power.offFor(5000);
