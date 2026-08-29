---
'@typecad/cuttlefish': major
'@typecad/hal': minor
'@typecad/framework-zephyr': minor
'@typecad/expect': patch
---

Legacy-HAL removal — **Phase 1b: framework-arduino and the AVR path are deleted.** This retires the "frozen Arduino" surface; the repository is Zephyr (+ native desktop simulator) only.

**Deleted packages**:
- `@typecad/framework-arduino` — the ArduinoStrategy, Adafruit display/touch adapters, arduino-cli compile/upload integration, AVR profiles, doctor. Its published npm artifacts remain installable for old projects.
- `mcu-atmega328p`, `board-arduino-uno` — AVR silicon has no Zephyr port; the Uno/pro-mini hardware story ends here.

**Deleted demos** (frozen-Arduino targets): ble-demo, demo-display, demo-pro-mini, demo-safety, demo-st, demo-ui, demo-ui-sd13, demo-weather, rmt-demo. Their thin-Zephyr counterparts exist (zephyr-display/zephyr-ui/zephyr-weather/zephyr-blink family) or are covered by the hal rig.

**Deleted test surface**: ~150 test files whose assertions were specifically about the removed Arduino lowerings (transpileArduino/AVR/ESP32 helpers, uno wiring, Arduino manifest/avr-profile suites) — they tested deleted behavior and die with it. Remaining verified battery: 3228 passing across 314 files after cleanup, including the full framework-zephyr directory, compliance, manifests, expect dry-runs, and token sync.

**Test harness**: `tests/setup.ts` + `tests/setup-framework.ts` now register `ZephyrStrategy` as the default loaded framework; the deleted transpileArduino/transpileAVR/transpileESP32 helpers are gone. The boardConstants injection for board-derived chip resolution was re-applied (it briefly vanished with the setup restore).

**Deferred deliberately**: `@typecad/arduino-cli` package remains — @typecad/expect's host compiler imports its env-check helper; unwrapping that dependency is a small follow-up before it too can go. Root README/docs mentions of Arduino are Phase-4 documentation work.
