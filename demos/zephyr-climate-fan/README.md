# zephyr-climate-fan — climate fan bench (WeAct Black Pill V2.0)

A mildly complex two-module demo built to exercise the typeCAD/hal
transpiler's object model and HAL lowering end to end:

- **`src/control.ts`** — pure logic, no hardware: a numeric `enum`
  (`FanMode`), an `interface` with an implementing class
  (`RingStats implements TelemetrySource`), inheritance with `super()` and
  an overridden `protected` method dispatched through the base class
  (`BandThreshold extends Threshold`), a `static` factory + `static` counter
  (`Pid.bench()` / `Pid.constructed`), private/protected/readonly fields,
  a getter (`pid.integral`), arrays, `switch`, loops, and compound
  assignment.
- **`src/main.ts`** — hardware wiring: SHT30 on I2C0 (0x44), 25 kHz PWM fan
  on PB6, PA1 trim pot (ADC), LED heartbeat in a `Thread`, KEY button on a
  GPIO interrupt (flag-only ISR), mode persisted in a settings `Store`,
  UART0 status lines.

## Pipeline

```sh
npx typecad-hal build            # TS → C++ (src/out/src/*.cpp|*.h)
npx typecad-hal build --compile  # + west build for blackpill_f401cc
```

## What the console shows

At 115200 baud on UART0 (and USB console): a boot line with the persisted
mode, `[mode]` lines when KEY cycles OFF → AUTO → BOOST → MANUAL, an
`[alarm]` line when the temperature leaves the −5…55 °C band, and a status
line every 5 samples (`t=…C avg=…C set=…C duty=…% mode=…`).

## Wiring

| Signal | Pin | Notes |
| :--- | :--- | :--- |
| SHT30 SDA/SCL | PB9/PB8 | I2C0, address 0x44 |
| Fan PWM | PB6 | TIM4_CH1, 25 kHz |
| Setpoint pot | PA1 | ADC1_IN1 |
| KEY button | PA0 | falling-edge interrupt |
| LED | PC13 | heartbeat thread, 250 ms |
