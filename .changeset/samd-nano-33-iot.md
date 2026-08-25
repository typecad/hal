---
'@typecad/mcu-samd21': minor
'@typecad/board-nano-33-iot': minor
'@typecad/framework-zephyr': minor
'@typecad/cuttlefish': minor
---

## SAMD21 support: the Arduino Nano 33 IoT (`arduino_nano_33_iot/samd21g18a`)

The first Microchip SAM target. `@typecad/mcu-samd21` defines the SAMD21G18A
silicon as wired on the Nano 33 IoT (34 modeled pins in port-block numbering —
PA<bit> → bit, PB<bit> → 32+bit — sercom4 I2C / sercom1 SPI / sercom5 UART,
12-bit ADC with 7 header-reachable channels, TCC2 PWM; interrupt capability
is per-pin because SAM D21 only wires EXTINT to port pins 0–15), and
`@typecad/board-nano-33-iot` ships the board chip data verified against
Zephyr 4.3's `arduino_nano_33_iot` devicetree: per-port porta/portb
controllers, the `led0` (D13/PA17) DT spec, the board-shipped `pwm-led0`
PWM alias (tcc2/WO1, 46.875 kHz counter clock at the dts prescaler), the
USB CDC device (per-board PID 0x2FE3:0x0003), and the ADC channel map
(`ADC_GAIN_1` + `ADC_REF_VDD_1_2` — the only reference combination Zephyr's
sam0 ADC driver accepts on this SoC; reads saturate above ~1.65 V).
`cuttlefish create --target nano-33-iot` scaffolds it; flashing works over
the built-in BOSSA USB bootloader (`bossac`, double-tap reset) or via
openocd/jlink on the underside SWD pads.

Scope notes:

- **WiFi and BLE are unsupported.** The onboard NINA-W102 radio has no
  descriptor fields, so `wifi.*` / `ble.*` ops fail diagnostics with a clear
  error; its control pins (SPI/UART/reset/irq/ready) are documented as
  repurposable GPIO with warnings.
- **No watchdog node.** Zephyr's samd21 dtsi exposes no watchdog devicetree
  node, so `wdt.*` ops are flagged and `features.watchdog` is false. This
  surfaced a framework gap, now fixed: `lowerWdt` takes the chip descriptor
  and lowers wdt ops to comments on watchdog-less targets (previously a
  compile error referencing undeclared shim vars), plus a new
  `zephyr-wdt-unavailable` profile diagnostic — mirroring the hwtimer
  pattern.
- Storage uses the board dts's own `storage_partition` (16 KB at 0x3c000) —
  no synthesized partition needed.
- **1200-baud touch-to-reset.** Boards whose bootloader cooperates can now
  declare `zephyr.usb.touchReset` (flag address + magic + the bootloader's
  USB identity). The device side: the emitted USB shim registers a usbd
  message callback; when the host sets the CDC baud rate to 1200, the shim
  writes the bootloader's stay-resident magic to RAM (Arduino SAMD scheme:
  0x07738135 at the last word of SRAM) and `NVIC_SystemReset()`s — the board
  lands in the bootloader with no button press. The host side: bossac
  uploads open the app port at 1200 baud, wait for the bootloader identity,
  and flash that port (the touch itself may surface as a port-open error —
  the device resets mid-open — which is handled as success). Verified
  end-to-end on the Nano 33 IoT: `cuttlefish-test` now re-flashes and runs
  the suite with zero manual reset presses.
