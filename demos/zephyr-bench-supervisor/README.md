# zephyr-bench-supervisor — bench supervisor (WeAct Black Pill V2.0)

A two-module demo built to exercise the typeCAD/hal transpiler's
collection, text, and polymorphism surface end to end — the second demo in
the find-transpiler-issues series (after `zephyr-climate-fan`, which
stressed the object model and HAL boundary):

- **`src/console.ts`** — pure logic, no hardware: numeric `enum`s with
  `switch`, a `Record<string, string>` table with dot access, `Map` counters
  with `?? default` fallbacks, an interface (`Sink`, `CommandHandler`)
  implemented by several classes and dispatched through a
  `Map<number, CommandHandler>` (virtual calls through interface
  references), a byte-stream line assembler driven by charCodes, fixed-point
  parsing by hand, `toString(16)`/`padStart`/`toFixed` formatting, and a
  fixed-capacity event ring.
- **`src/main.ts`** — hardware wiring: console commands over UART0 RX
  (`D` dump log, `C` clear, `L <mv>` alarm level, `H` help), PA1 pot
  streaming into an 8-bucket histogram, threshold alarm with `Trace`
  events, KEY button log dump (flag-only ISR), hardware `Watchdog`, and a
  heartbeat `Thread`.

## Pipeline

```sh
npx typecad-hal build            # TS → C++ (src/out/src/*.cpp|*.h)
npx typecad-hal build --compile  # + west build for blackpill_f401cc
```

## What the console shows

At 115200 baud on UART0: a boot line (`[boot] bench-supervisor ready — 4
commands, level=2750mV`), `[alarm]` lines when the pot crosses the level,
and a report every 15 s (sample count, histogram bar `[.++.#..+]`, event
counters, newest log entries). Type `D`/`C`/`L 2000`/`H` (+ Enter) on the
console to drive the command dispatcher; the KEY button dumps the log.

## Wiring

| Signal | Pin | Notes |
| :--- | :--- | :--- |
| Console | UART0 | USART1 TX/RX (board's USB-serial), 115200 8N1 |
| Setpoint pot | PA1 | ADC1_IN1, 0–3300 mV histogram span |
| KEY button | PA0 | falling-edge interrupt, flag-only ISR |
| LED | PC13 | heartbeat thread, 250 ms |

## Transpiler notes

The demo names its event log `log` — a libc-reserved name — exercising the
reserved-name escape end to end: the variable renders as `log_` at its
declaration and every reference, and survives tree-shaking (references bake
the escape into callee text; the alias mapping in reachability.ts marks the
declaration reachable).
