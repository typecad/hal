---
'@typecad/cuttlefish': minor
'@typecad/framework-zephyr': minor
'@typecad/board-blackpill-f411ce': minor
---

## console.output: route console.log, and say where it goes

`console.log` follows the board's devicetree console node, which is often a
UART on pins nobody wired — and nothing said which. Two changes:

- **Build note.** When the program's output uses printk (what console.log
  lowers to), the compile prints its destination — e.g.
  `console.log -> printk -> usart1 on PA9 (TX) / PA10 (RX) on this board`.
  Boards carry a human `zephyr.consoleDescription` for this (the Black Pill
  ships one).
- **`console.output: 'usb'`** in cuttlefish.config.ts's `console` section
  routes console.log onto the USB CDC serial port instead: the overlay
  composes the CDC port (even if the program never calls USB0) and rebinds
  `chosen zephyr,console`, and prj.conf forces the USB device stack on.
  Setting it on a board without USB warns and keeps the board default.
