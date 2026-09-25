# matrix-station

A USB keyboard-free input station for the ESP32-S3 DevKitC exercising the
three wired-input HAL classes together: **Matrix** (scanned key matrix),
**Servo** (calibrated PWM output), and **Strip** (addressable LEDs), with
status on the console UART.

## Wiring

| Thing | Pins |
| --- | --- |
| Matrix rows | GPIO4, GPIO5 |
| Matrix cols | GPIO6, GPIO7 |
| Servo data | GPIO8 (50 Hz; any LEDC pad works) |
| LED strip data | the SPI0 bus MOSI pad (`worldsemi,ws2812-spi`) |
| Console | UART0 through the on-board USB-UART bridge (115200) |

No keypad is needed to try it — bridge a row pin and a column pin with a
jumper to "press" that crossing.

## Behavior

- Each of the four keys commands a quarter of the servo travel
  (0 / 90 / 180 / 270°) — the servo reads like a dial.
- The strip mirrors it: a red marker pixel sits at `2 × key`, the rest dark.
- The key press logs over the console, e.g. `key 2 -> servo 180 deg, pixel 4`.

## Build & flash

```sh
npm run upload
```
