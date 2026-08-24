---
'@typecad/cuttlefish': minor
'@typecad/framework-zephyr': minor
'@typecad/board-rp2040': minor
'@typecad/board-rp2350': minor
'@typecad/mcu-rp2040': patch
'@typecad/mcu-rp2350': patch
---

## Raspberry Pi Pico / Pico 2 — Zephyr parity and fixes

Close the gaps the USB CDC commit (a9bcb6ea) left on the RP2040/RP2350
boards, plus one capability breakage that affected both frameworks:

- **fix(mcus): `analogRead` works again.** The board-constants flattener is a
  static AST walker; `functions: [adc(0, 0)]` (helper-call array elements)
  and shorthand `capabilities` references flatten to nothing, so the
  pin-capability validator rejected every analog pin on both boards with
  "no pins support analog input". The MCU packages now carry inline object
  literals (the pattern every working MCU package already used). mcu-rp2350
  also marks GP23/GP24/GP25/GP29 unsafe (SMPS power-save, VBUS detect, LED,
  VSYS monitor on the Pico 2), mirroring mcu-rp2040.
- **feat(boards): USB CDC serial (`USB0`).** Both Pico boards declare
  `zephyr.usb` (`zephyr_udc0`, enabled by default in the rpi_pico /
  rpi_pico2 DTS, backed by the `udc_rpi_pico.c` next-stack driver) and
  export `USB0` — USB CDC is the Pico's primary serial link. Verified with
  a full west build: the overlay composes the CDC class instance and the
  prj.conf emits the `USB_DEVICE_STACK_NEXT` symbols.
- **feat(boards): named probe methods** (`uf2` BOOTSEL bootloader, `openocd`
  CMSIS-DAP SWD, `jlink`) so `zephyr.probe` / `--probe` work without the raw
  runner escape hatch; `consoleDescription` (uart0 on GP0/GP1) for the
  console-destination build note; `i2c1` declared (GP6/GP7 — the board DTS
  ships its pinctrl group, so `Wire1`/`I2C1` now works instead of erroring).
- **fix(board-rp2350): honest pin collections.** The pins arrays dropped
  GP23–GP25/GP29 (board-internal) and GP30–GP33 (they don't exist on the
  Pico 2's RP2350A — `rp2350a.dtsi` sets gpio0 `ngpios = <30>`), matching
  the actual header (GP0–GP22 + GP26–GP28).
- **feat(cuttlefish): `cuttlefish create` offers Zephyr for the Pico boards**
  (architecture map, qualified west targets `rpi_pico` /
  `rpi_pico2/rp2350a/m33`, and the wizard's probe-method table).
- **fix(cuttlefish): peripheral capacity derives from declared instances.**
  `peripherals.<bus>.count` defaulted to 1 when the board carried no
  explicit count, rejecting the second I2C/SPI/UART the MCU actually
  declares (Wire1/SPI1/Serial2 on the arduino-pico and ESP32 cores); the
  count now falls back to the flattened instance entries.
- **feat(framework-zephyr): build-time diagnostics for silent no-ops.**
  `pwm`/`tone` on a pin with no chip-descriptor spec now warns (previously a
  silent comment no-op — the Pico boards ship no PWM specs), and an
  i2c/spi/uart instance beyond the declared controllers is a clear error
  (previously an undefined-symbol link failure).
- **fix(framework-zephyr): I2C/SPI class usage no longer breaks west builds.**
  Three fixes found while e2e-verifying I2C1 on real `west` builds:
  `filterRequiredIncludes` now strips the Arduino library headers the HAL
  registers (`<Wire.h>`/`<SPI.h>`/`<EEPROM.h>` — gcc: "Wire.h: No such file
  or directory"); bus shim state is emitted only for the controller indexes
  the program drives (an unused declared controller's static state trips
  Zephyr's -Werror `-Wunused-variable`); and the overlay usage scan accepts
  the shim's `__tc_<bus>N` state tokens, so a begin()-only program still
  gets its DT node enabled (previously a missing `__device_dts_ord_*`
  device error). The overlay also enables only the used controllers — an
  enabled-but-unused i2c0 would claim GP4/GP5 that a program driving i2c1
  may want as GPIO. Verified with full `west` builds for `rpi_pico` and
  `rpi_pico2/rp2350a/m33`: USB CDC (`USB0.println`), ADC reads, `I2C1`, and
  `console.output: 'usb'` (printk rebound onto the CDC port) all compile
  to `zephyr.bin`.
