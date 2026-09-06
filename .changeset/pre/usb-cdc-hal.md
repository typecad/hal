---
'@typecad/cuttlefish': minor
'@typecad/hal': minor
'@typecad/framework-zephyr': minor
---

## USB CDC-ACM serial HAL (`USB0`)

The reserved endpoint-level `usb.*` op surface (usb.init/write/read with
endpoint indices, never implemented) is replaced with a **class-level,
serial-shaped** surface matching Zephyr's "next" USB device stack, where
composition is devicetree's job and a CDC-ACM instance is just a UART device:

```ts
import { USB0 } from '@typecad/board';           // board with a USB port

USB0.begin(115200);                               // usb_enable() + line coding
USB0.println("hello over the connector");
if (USB0.connected()) { ... }                     // DTR — host opened the port
```

- **`@typecad/hal`**: new `USBSerialPort` class (`begin/end/print/println/
  printf/write/read/available/flush/connected/waitForConnection`) exported
  alongside `SerialPort`.
- **`@typecad/cuttlefish`**: `usb.*` HAL ops reshaped to the serial form
  (port-identified, like `uart.*`); `USB0`/`USBn` receivers resolve like
  `UART0`; new `usesUsb` program-analysis flag.
- **`@typecad/framework-zephyr`**: `lowering/usb.ts` lowers the ops against
  `DT_NODELABEL(cdc_acm_uart<N>)` with the same per-byte `uart_poll_out`
  loops as uart; `begin` guards a one-shot `usb_enable()`; `connected` polls
  `UART_LINE_CTRL_DTR`. The overlay enables the board's UDC controller
  (`zephyr_udc0`) and composes the declared number of `cdc-acm-uart` class
  instances; prj.conf gains `CONFIG_USB_DEVICE_STACK_NEXT`,
  `CONFIG_USBD_CDC_ACM_CLASS` and `CONFIG_UART_LINE_CTRL` (Zephyr 4.3
  symbol names, verified against `subsys/usb/device_next/Kconfig`) — all
  usage-gated, so a program that touches no USB emits none of it. The shim
  emits the full next-stack device context (`USBD_DEVICE_DEFINE` + string
  descriptors + `USBD_CONFIGURATION_DEFINE` + `usbd_register_all_classes` +
  one-shot `usbd_enable`), with VID/PID overridable via `zephyr.usb.vid/pid`
  (Zephyr-test defaults `0x2fe3/0x0001`). Boards declare the capability via
  `zephyr.usb: { controller, cdcInstances }` in the board package; ops on a
  board without it fail with a clear diagnostic.
- **`@typecad/board-blackpill-f411ce`**: declares `zephyr_udc0` (OTG_FS on
  PA11/PA12, one CDC instance) and exports `USB0` — `USB0.println` now goes
  out the USB-C connector while `UART0`/`console.log` stay on USART1
  (PA9/PA10). The zephyr-blackpill demo reports its mode + sense voltage
  over USB CDC as the hardware canary.
- The xiao_ble chip descriptor (the framework's default) also declares its
  nRF52840 native USB, so `USB0` works there too.
- **STM32F4 SWD recovery**: every STM32F4 build now sets the DBGMCU
  DBG_SLEEP/DBG_STOP/DBG_STANDBY bits at boot (emitted `SYS_INIT` +
  `CONFIG_STM32_ENABLE_DEBUG_SLEEP_STOP`). Without them the core's debug
  port is gated during WFI idle and openocd cannot examine or halt the
  running target — "Failed to read memory at 0xe000ed04" — leaving
  BOOT0-bootloader entry as the only way back in on boards without an RST
  pad (the Black Pill). Also adds a `stlink-srst` probe method
  (connect-under-reset) for setups that do wire SRST.
- **STM32 PWM 16-bit fix**: slow PWM periods (the 20 ms servo convention)
  overflow the timers' 16-bit ARR at ÷1 prescaler and `pwm_stm32` rejected
  them ("period cycles exceeds 16-bit timer limit"). The chip descriptor
  now carries the timer input clock (`zephyr.pwm.clockHz`), and the overlay
  generator derives the smallest `st,prescaler` on the timers node that
  fits the slowest used period (blackpill TIM4 @ 96 MHz, 20 ms → ÷30).
- framework-arduino keeps usb unsupported (no USB device stack on
  AVR/SAMD cores) with an updated per-op declaration.
