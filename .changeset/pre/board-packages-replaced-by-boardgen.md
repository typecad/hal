---
'@typecad/cuttlefish': minor
'@typecad/framework-zephyr': minor
'@typecad/expect': minor
---

Board and MCU packages are gone — replaced by SDK-derived, project-local board modules.

The 18 hand-maintained packages (`@typecad/board-*`, `@typecad/mcu-*`) duplicated data the Zephyr tree already carries. They are deleted outright; no shims, no deprecation path. What replaces them:

- **A generated board data pack** (`framework-zephyr/src/sdk/board-data.generated.ts`): 1311 board variants extracted from the pinned Zephyr 4.4 tree by a tolerant DTS reader — LED/BUTTON devicetree specs, console UART, connector gpio-maps — regenerated explicitly via `node scripts/gen-zephyr-board-data.mjs`.
- **Consolidated soc descriptors** (`framework-zephyr/src/chips/soc/`): the nine validated SoCs' silicon facts (GPIO controller splits, ADC channel maps, PWM matrices, probe methods, custom-board inputs) in one registry keyed by SoC name, mechanically migrated from the package data by `scripts/gen-soc-descriptors.mjs` plus curated tier/naming/exclusion facts.
- **boardgen** (`framework-zephyr/src/boardgen.ts`): joins a pack entry with its soc descriptor and emits `.cuttlefish/board.ts` (typed `Pin.fromPort` datasheet names, LED/BUTTON, connector labels, bus selectors) + `.cuttlefish/board.json` (the BoardConstants flat map, pin manifest, tier). Projects get both on first build; they are project-pinned and diffable.

**Config shape:** `board:` is now a qualified Zephyr target (`'esp32s3_devkitc/esp32s3/procpu'`); `mcu:` is gone. Contract projects (custom PCBs) use `soc: 'stm32f411xe'` + `contract:` — the narrowed board and the soc's board.json generate from the registry. The scaffold wizard, `cuttlefish create` targets, and starter programs ride the same catalog (any of the 1311 targets; starters are thin-HAL).

**Resolution:** `import { GPIO2 } from '@typecad/board'` resolves to the project-local generated module (a walk-up from the source file); chip resolution keys off the manifest's `zephyr.soc` into the soc registry. Hardware-verified end to end on the ESP32-S3 rig (WiFi/store/File+MQTT suites) with no board package anywhere in the tree.
