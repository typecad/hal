# RMT peripheral demo — ESP32-S3 onboard WS2812 RGB LED (GPIO48)

Drives the ESP32-S3-DevKitC onboard addressable RGB LED via the **RMT**
peripheral (Remote Control Transceiver).

The `RmtChannel` class wraps an RMT channel bound to a GPIO pin. This demo
configures a TX channel on `LED` (GPIO48) with WS2812 bit timings, then
animates a green-channel "breathe" (0..255 ramp). Integer-only arithmetic
keeps the TX buffer `uint8_t` with no float narrowing.

## Status

This demo targets `@typecad/framework-arduino` (arduino-cli) on ESP32-S3, but
**RMT lowering is not yet implemented on that framework** — RMT is an
ESP32-specific peripheral with no Arduino-core / Zephyr equivalent. The demo
will currently fail to compile (`rmt.*` HAL ops return `undefined`). It is
retained as a placeholder pending either a framework-arduino RMT lowering or
removal. See the workspace-wide framework trim notes.

## Running

```bash
npm install        # link workspace deps (@typecad/framework-arduino, board, mcu)
npm run lint       # ESLint with the cuttlefish transpiler-rules plugin
npm run compile    # transpile TS -> C++ and build with arduino-cli (currently fails — see Status)
npm run upload     # (with a PORT env/arg) flash + monitor
```

## What it exercises

- `RmtChannel(LED).txInit(resolutionHz, bit0Hi, bit0Lo, bit1Hi, bit1Lo, msbFirst)`
  → lowers to `rmt_new_tx_channel` + `rmt_enable` + `rmt_new_bytes_encoder`,
  emitted as a per-pin `__tc_rmt_tx48` shim block (file-scope statics +
  lazy `__tc_rmt_tx48_init()`).
- `txWriteBytes([g, r, b])` → `rmt_transmit` with the bytes-encoder.
- `txWaitDone()` → `rmt_tx_wait_all_done`.
- The generated `main/CMakeLists.txt` REQUIRES `esp_driver_rmt` (plus the
  LEDC/ADC/DAC components the framework also needs on IDF v6).
