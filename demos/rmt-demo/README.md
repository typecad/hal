# RMT peripheral demo — ESP32-S3 onboard WS2812 RGB LED (GPIO48)

Drives the ESP32-S3-DevKitC onboard addressable RGB LED via the **RMT**
peripheral (Remote Control Transceiver), exercising the
`@typecad/framework-esp32` RMT lowering end-to-end against native ESP-IDF.

The `RmtChannel` class wraps an RMT channel bound to a GPIO pin. This demo
configures a TX channel on `LED` (GPIO48) with WS2812 bit timings baked into
the IDF bytes-encoder at 10 MHz tick resolution, then animates a green-channel
"breathe" (0..255 ramp). Integer-only arithmetic keeps the TX buffer `uint8_t`
with no float narrowing.

## Running

```bash
npm install        # link workspace deps (@typecad/framework-esp32, board, mcu)
npm run lint       # ESLint with the cuttlefish transpiler-rules plugin
npm run compile    # transpile TS -> ESP-IDF C++ and build with idf.py
npm run upload     # (with a PORT env/arg) flash + monitor
```

`npm run compile` requires ESP-IDF v5.x/v6.x on `$PATH` (or `$IDF_PATH` set).
The generated ESP-IDF project lands in `src/out-esp32s3/`.

## What it exercises

- `RmtChannel(LED).txInit(resolutionHz, bit0Hi, bit0Lo, bit1Hi, bit1Lo, msbFirst)`
  → lowers to `rmt_new_tx_channel` + `rmt_enable` + `rmt_new_bytes_encoder`,
  emitted as a per-pin `__tc_rmt_tx48` shim block (file-scope statics +
  lazy `__tc_rmt_tx48_init()`).
- `txWriteBytes([g, r, b])` → `rmt_transmit` with the bytes-encoder.
- `txWaitDone()` → `rmt_tx_wait_all_done`.
- The generated `main/CMakeLists.txt` REQUIRES `esp_driver_rmt` (plus the
  LEDC/ADC/DAC components the framework also needs on IDF v6).
