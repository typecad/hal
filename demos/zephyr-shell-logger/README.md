# zephyr-shell-logger — sentence shell over USB CDC (WeAct Black Pill V2.0)

Third demo in the find-transpiler-issues series (after `zephyr-climate-fan`
and `zephyr-bench-supervisor`), built to stress the hardened surfaces —
the one-string model, `.split()`, native string append, the reserved-name
escape — on shapes earlier rounds never touched: the USB CDC console, the
littlefs `File` store, an async boot sequence, and a text-heavy wire
protocol.

- **`src/proto.ts`** — the `$CMD,field,...*CS` grammar, pure logic: charCode
  XOR checksums over a for-of string loop, `parseInt(text, 16)` hex fields,
  `split`/`join` round trips, a `Map<string, string>` settings table with
  `??` defaults and `delete`, an interface with two reply formatters
  dispatched through a base reference, `toString(16)`/`padStart` formatting,
  and native `+=` accumulation.
- **`src/main.ts`** — wiring: line assembler over CDC RX, async boot
  (`await Time.sleep` state machine), settings persisted to `session.cfg`
  in littlefs, KEY-button log dump (flag-only ISR), LED heartbeat thread.
  The event log file is named `log` — a reserved libc name — exercising the
  reserved-name escape on a HAL-class instance.

## Pipeline

```sh
npx typecad-hal build            # TS → C++ (src/out/src/*.cpp|*.h)
npx typecad-hal build --compile  # + west build for blackpill_f401cc
```

## The protocol

Send sentences terminated by newline on the CDC port:

```
$SET,gain,1.5*CS        → $OK,gain,1.5*CS
$GET,gain*CS            → $OK,gain,1.5*CS
$LST*CS                 → $LST,gain=1.5;rate=10;*CS
$CLR,gain*CS            → $OK,gain,*CS   (or $ERR,no-key*CS)
```

A bad checksum draws `$ERR,cs:*CS`; every 6th handled command draws a
`$STAT` line with ok/bad/keys counters. The KEY button dumps the stored
file's character count.

## Wiring

| Signal | Pin | Notes |
| :--- | :--- | :--- |
| Console | USB CDC | `USB0`, 115200 virtual serial |
| Settings | littlefs | `session.cfg` on the storage partition |
| KEY button | PA0 | falling-edge interrupt, flag-only ISR |
| LED | PC13 | heartbeat thread, 250 ms |

## Transpiler notes

Known sharp edges worked around in this demo (each pinned or documented in
the changeset): async-task locals/params are not threaded into the task
class yet (the boot is pure pacing; values cross at the call site), and a
concat inside an array-literal argument renders as raw `const char* +
double` (parts are hoisted to locals first). `usb.available()` is honestly
`(0)` — the CDC poll API cannot count bytes without draining them — so the
RX loop is read-first (`read() < 0` = empty).
