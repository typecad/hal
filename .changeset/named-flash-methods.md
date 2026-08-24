---
'@typecad/cuttlefish': minor
'@typecad/framework-zephyr': minor
'@typecad/board-blackpill-f411ce': minor
'@typecad/board-xiao-nrf52840': minor
---

## Named probe methods: pick `stlink`/`dfu`/`jlink` for flashing AND debugging

Users think "I have an ST-Link", not "openocd with `--cmd-pre-init=reset_config
none`". Attachment — flashing and debugging alike — is now selected by a
board-defined name:

- **Board packages ship a `probeMethods` table** mapping friendly ids
  (`stlink`, `dfu`, `jlink`, `uf2`, `openocd`) to the west runner plus the
  args the method always needs. Hardware quirks live with the board data
  where they're verified, not in user configs. One method serves both
  surfaces; entries that cannot debug (bootloaders) set `debug: false`.
  The Black Pill ships stlink/dfu/jlink; the XIAO ships jlink/openocd/uf2.
- **`zephyr.probe`** in cuttlefish.config.ts selects one; **`--probe <id>`**
  on the CLI overrides it for a single run. Unknown ids fail with the
  board's supported list; `probe` + `runner` together is rejected. User
  `runnerArgs` still append after a method's flags, so they can override.
- **Debugging resolves through the same method.** The toolchain's `debug()`
  runs `west debug` with the method's runner + quirks, and rejects
  debug-incapable methods with the debug-capable list ("a bootloader is not
  a debugger"). The VS Code launch.json/openocd.cfg generation feeds from
  the table too: method-carried cfg sources + quirk lines, cortex-debug
  `servertype: jlink` (with the board's device name) vs `openocd`, and the
  wire interface (swd vs the ESP32's jtag).
- **`cuttlefish create` asks** which probe you'll attach when the board has
  options, and writes the config section; `--probe` on create answers it
  non-interactively.
- **`cuttlefish doctor` lists** the board's methods, with the debug-capable
  subset on its own line.

No auto-detection: the method is always something you chose.
