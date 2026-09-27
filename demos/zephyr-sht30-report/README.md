# zephyr-sht30-report — SHT30 → HTTPS reporter

Samples a Sensirion SHT30 over I2C and POSTs a JSON climate report to an
HTTPS endpoint over WiFi, on `esp32_devkitc/esp32/procpu`.

## Program shape

- `SampleWindow` — rolling 5-sample window (min/max/avg) over temperature
  and humidity.
- `linkWatch()` — async task logging link drops/recoveries every 500 ms.
- `reporter()` — async task sampling every 2 s; every 5th sample it builds
  the JSON payload (dew point via Magnus-Tetens, window stats, RSSI,
  uptime) and POSTs it with exponential backoff on failure.

Both tasks are cooperative: every `await` splits into start+poll states in
the emitted C++, so neither blocks the other.

## Assumptions (edit to match your rig)

- **Sensor wiring** — SHT30 at `0x44` on `I2C0`. The board's devicetree
  wires I2C0 to the DevKitC defaults (SDA=GPIO21, SCL=GPIO22). On ESP32 any
  pad can be any peripheral, so different wiring is hand-typed by remuxing
  the controller (display/touch-style `sda`/`scl` config or an overlay),
  not by choosing a different bus object.
- **Endpoint** — `REPORT_URL` and `DEVICE_ID` in `src/main.ts` are
  placeholders.
- **TLS** — `CA_PEM` is a fake placeholder; verified TLS fails closed
  against it. Replace with the PEM your endpoint's chain anchors to, or
  swap `caCert` for `insecure: true` for lab use.
- **Credentials** — `WIFI_SSID` / `WIFI_PSK` are placeholders.

## Build

```sh
npm run build     # transpile → src/out
npm run compile   # + west build → src/out/build
npm run upload    # + west flash + monitor
```

Console output (boot banner, link transitions, report status lines) rides
uart0 at 115200.

## Notes

- **TLS heap** — `typecad-hal.config.ts` pins `CONFIG_MBEDTLS_HEAP_SIZE=70000`
  (the framework default is 100000). The float-printf support the `%g` report
  formats require (`CONFIG_CBPRINTF_FP_SUPPORT` + the complete cbprintf
  implementation) plus `CONFIG_SENSOR` pushed the plain ESP32's DRAM over by
  ~25 KB at link time; 70 KB still covers a 16 KB TLS record pair plus the
  pinned CA. On an ESP32-S3 (more DRAM) the default fits.
- **TLS** — replace the placeholder `CA_PEM` with your endpoint's real chain
  anchor; verified TLS fails closed against the placeholder. For lab use,
  swap `caCert` for `insecure: true`.
