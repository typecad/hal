---
'@typecad/hal': minor
'@typecad/cuttlefish': minor
'@typecad/framework-zephyr': patch
---

Complete the legacy-HAL removal: delete the dead op/stub chain and the
Arduino-era API surface.

hal: 48 editor-facing emit stubs deleted — the i2c wire-dance, spi manual-CS,
uart print/stream family, rmt, tone free functions, pulseIn, gpioSetMode,
adcReadVoltage/adcSetReference, getMicros and httpSendStart leftovers whose
op families no longer exist end-to-end. The Arduino digital constants
(HIGH/LOW/INPUT/INPUT_PULLUP/…/LED_BUILTIN, LSBFIRST/MSBFIRST) and the AVR
WDTO_* presets are removed; WDTClass (superseded by the thin Watchdog) is
deleted. USBSerialPort stays — mcu packages depend on it.

cuttlefish: the 10 legacy uart.* stream op kinds, their plugin cases,
peripheral-usage arms, probe payloads and union members are gone, along with
the 9 never-manifested spi.begin_transaction/cs_low/set_mode/read_buffer/
shift.in/out kinds — a manifest audit confirmed every remaining op kind is
declared by framework-zephyr (ble/eth/mdns/ota/twai are declared
programmatically). The framework registry drops @typecad/framework-arduino;
the inert avr/megaavr/esp8266 rows in the polyfill stdlib-support table, the
avr entry in the radioless-architecture set and the heap-analysis AVR size
note are pruned.

safety: AnyPin collapses to the thin GPIO type now that InputPin/OutputPin
no longer exist in hal.

boards: board-esp32-devkit/c3/c6/s3/rp2040/rp2350 drop ARDUINO_CORE_VERSION,
their `build.frameworks.arduino` FQBN entries and the ARDUINO* defines — the
Zephyr build target remains the only declared one.

docs/demo hygiene: docs/arduino-cli-environment-check.md is deleted; the
framework authoring guide now references ZephyrStrategy and framework-zephyr
end-to-end; thin-hal.md corrected (the Arduino-named surface is removed, not
frozen); demo-shadcn's vendored Adafruit library trees are removed (verified
unused); the debug-extension README source is rewritten for console-based
targets and re-propagated to all demo copies.
