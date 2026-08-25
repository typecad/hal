---
'@typecad/cuttlefish': minor
'@typecad/mcu-atmega328p': minor
'@typecad/mcu-esp32': minor
'@typecad/mcu-esp32c3': minor
'@typecad/mcu-esp32c6': minor
'@typecad/mcu-esp32s3': minor
'@typecad/mcu-nrf52840': minor
'@typecad/mcu-rp2040': minor
'@typecad/mcu-rp2350': minor
'@typecad/mcu-samd21': minor
'@typecad/mcu-stm32f411': minor
'@typecad/framework-zephyr': minor
---

## MCU-only targets: program bare silicon without a board package

An `mcu:`-only config (no `board:`) now works end to end. Previously the
transpiler silently accepted it but emitted untranslated pin calls (broken
C++): the board-constants resolver only recognized `@typecad/board-*`
packages. `tryResolveBoardDefFile()` now resolves `@typecad/mcu-*` packages
(`src/mcu.ts` or inline `src/index.ts`) and loads the sibling
`peripherals.ts`, so pin lowering, capability validation, and peripheral
validation work from the silicon definition alone. `board` is un-deprecated:
boards layer assets on top of the MCU; MCU-only trades those assets for
hardware reach. All MCU packages now re-export `@typecad/hal` (mirroring
board packages), so `@typecad/board` code resolves identically either way.

### Zephyr custom-board generation (`zephyr.customBoard: true`)

MCU packages carry a **silicon-level `zephyr` block** (the lower layer of the
board packages' field — SoC name(s), devicetree includes, GPIO controller
split, default console mux, default clock plan; `mcu-stm32f411` ships the
first one, `MCUDefinition.zephyr` is the typed field). With
`zephyr: { customBoard: true }` in cuttlefish.config.ts, framework-zephyr
generates an out-of-tree board for the chip under `boards/typecad/<buildTarget>/`
(board.yml + dts + Kconfig.<name> + defconfig — the four load-bearing files
verified by building a hand-written minimal board against Zephyr 4.4). The
app's CMakeLists.txt adds itself to BOARD_ROOT, the usage-driven overlay
keeps layering on top, and `resolveChipFromBoard()` accepts silicon-resolved
chips (gated on `zephyr.socs`, no board target required).

End-to-end verified on the hardware toolchain: `cuttlefish create my-f411
--mcu stm32f411` then `cuttlefish build --compile` transpiles (PA5 → `gpioa`
pin 5 via the silicon controller split), generates the board, and links a
zephyr.bin. Contract-based configs (contract + mcu, board forbidden by the
schema) ride the same machinery: the narrowed `.cuttlefish/board.ts` plus
`zephyr.customBoard` for the PCB's own board.

### `cuttlefish create` for bare MCUs

`cuttlefish create --mcu <id>` scaffolds MCU-only projects (also offered in
the interactive wizard). Zephyr targets default to a generated custom board
named after the project, or pick any existing Zephyr board from the new
**exhaustive board snapshot** (1014 boards across 587 SoCs, enumerated from
the pinned Zephyr 4.4 revision via `scripts/gen-zephyr-boards.mjs` —
regenerate as part of the version-bump checklist), filtered by the MCU's
SoC. Arduino targets paste an FQBN found via `arduino-cli board search`
(`--fqbn arduino:avr:pro` non-interactively) — e.g. an Arduino Pro Mini with
no board package: `cuttlefish create my-pro-mini --mcu atmega328p --fqbn
arduino:avr:pro`.

v1 scope: the generated board enables the console UART only — non-console
buses need per-controller pinctrl synthesis data in the MCU package first
(STM32 bindings require pinctrl-0 on enabled nodes). Flashing a custom
board uses `zephyr.runner`/`runnerArgs` (no probe-method table on silicon).
