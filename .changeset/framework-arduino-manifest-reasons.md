---
"@typecad/framework-arduino": patch
---

## Corrected unsupported reasons for wifi/http

The manifest's `wifi`/`http` unsupportedReason strings pointed at
`framework-esp32`, a package that does not exist. They now state where ESP32
networking actually lives: `@typecad/hal` lowers WiFi natively against
ESP-IDF (`esp_wifi`) and HTTP over that stack, independent of the Arduino
framework manifest. This also flows through to the generated
`docs/framework-coverage.md` matrix.
