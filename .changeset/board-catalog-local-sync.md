---
'@typecad/cuttlefish': minor
'@typecad/framework-zephyr': minor
---

## Board catalog syncs from your own Zephyr tree

Board support no longer waits on a cuttlefish release. The tree walker that
generates the compiled-in board data pack moved into `@typecad/framework-zephyr`
(`src/sdk/catalog-walker.ts`) so it can run anywhere, and a new command
regenerates the catalog from the Zephyr checkout you actually build with:

- **`cuttlefish board sync [zephyr-base]`** — walks `<zephyr>/boards`, reading
  every variant's board DTS (LED/button devicetree specs, connector gpio-maps,
  pwm-leds, ws2812 strips), `board.yml` (both the multi-board `boards:` format
  and legacy single-board format), and `board.cmake` runner tables, then
  writes a local catalog overlay to `<workspace>/.cuttlefish/board-catalog.json`
  and prints what changed vs the built-in pack (added/changed/removed). It
  also regenerates the current project's board module so the sync lands
  immediately.
- **`cuttlefish board regen`** auto-refreshes a stale overlay first — after
  `west update` (which moves the tree's git HEAD/VERSION) or after a
  framework update (the overlay's `generatorRev` no longer matches), a plain
  regen picks up the tree's boards. The walk only happens when work is needed.
- All catalog lookups prefer the overlay: board generation (`boardgen`), the
  `cuttlefish create` wizard's board search, and `--board` target resolution.
  The overlay replaces (not merges with) the compiled-in pack.
- `scripts/gen-zephyr-board-data.mjs` is a thin wrapper over the same walker,
  so the shipped pack and local overlays come from identical logic.

## Curated board layer removed — every board resolves the same way

The hand-curated silicon layer is gone. There are no curated boards, no
curated soc descriptors, no board overrides, and no validated/derived tier:
`chips/soc/`, `chips/xiao-ble.ts`, `chips/esp32*.ts`,
`chips/board-overrides.ts`, the `chipForSoc`/`chipForTarget` registry, the
`DEFAULT_CHIP` (XIAO) fallback, and the create flow's curated nine target
entries / bare-MCU (`--mcu`) targets are all deleted.

Every board now resolves through one path:

- **boardgen** derives a GPIO controller table from the controller names in
  the board's own devicetree facts (vendor-family port conventions), sweeps
  every derived range into datasheet-named pins, and emits bus instances
  (`zephyr.i2c/spi/uart.controllers.*`), the USB device controller
  (`zephyr.usb.*` — present only when the board's DTS enables it), the
  watchdog (`zephyr.wdt.nodeLabel` — the devicetree watchdog0 alias), LED/
  button dtSpecs, and the board's own `board.cmake` probe table — all from
  the catalog record.
- **The strategy** reconstructs its chip view solely via
  `resolveChipFromBoard` over the generated manifest; unresolved boards stay
  `NO_BOARD_CHIP` and each subsystem reports unsupported. WiFi/HTTP/MQTT
  availability is family-derived from the soc name (esp32* has the radio).
- **Strap-pin exclusions are gone** — every pad sweeps like any other.
  Silicon facts that never live in devicetree (per-pin ADC channels, PWM
  matrices, DAC) are absent for every board alike; programs using them on a
  board whose DTS does not wire them now get honest diagnostics instead of
  silently-wrong lowering.

Removed with the layer: Zephyr bare-silicon/contract projects
(`soc:` configs and `cuttlefish create --mcu`) — their entire
implementation was the curated soc registry. Use a board target from the
catalog. Test fixtures now build their chip views through the same
`generateBoard` → `resolveChipFromBoard` path products use, augmenting with
explicitly-synthetic silicon fields where lowering logic needs inputs that
devicetree cannot provide.

## Walker fixes found during randomized verification

Three randomized hand-verification rounds (~40 boards checked against their
actual DTS/yaml/cmake sources) drove these extraction fixes, each with
regression tests:

- **board.yml qualification by key ownership** — the old
  "collect every soc in the file" heuristic silently dropped every board in
  a multi-board directory (the Zephyr 4.x `boards:` list format) and
  qualified `qemu_x86_lakemont` with another entry's soc. 31 boards
  recovered; runner args and includes now parse per-variant by matching the
  `CONFIG_BOARD_<name>` / `CONFIG_SOC_<soc>_<qual>` guard each target
  belongs to (first-wins where no guard matches).
- **Vendor-flavored runner includes** map to their real methods
  (`openocd-stm32`, `openocd-nrf5` → openocd; `esp32` → esptool), and the
  full west flasher set is covered (stm32cubeprogrammer, nrfutil, uf2,
  silabs_commander, probe-rs, rfp, bflb_mcu_tool, xsdb, wchisp, spsdk,
  minichlink, mdb-hw, wlink, gd32isp, sftool, teensy, nulink — all
  flash-only). CMake-variable args (`${CONFIG_SOC}`) are dropped. Runners a
  board guards behind another core's config are not offered to that target.
- **Comment handling** — a comment line inside a node no longer hides the
  property after it; comma-style gpio-map comments (`/* Pin 1, LEDK */`)
  yield real net-name labels instead of truncated garbage.
- **Duplicate runner includes** no longer mint duplicate probe methods.
- **Canonical LED/button follow the devicetree numbering** — the
  `led0`/`sw0`-aliased node is canonical, so `LED<N>`/`BUTTON<N>` manifest
  aliases match dtSpec numbering on every board.


## The static board database is gone — regen is the mechanism

The 102k-line compiled-in board pack (`board-catalog.generated.ts`) is
deleted, along with the repo-side generator script. There is exactly one
catalog source: the user's own Zephyr tree.

- **Catalog tooling moved into cuttlefish** (`src/board-catalog/`): the
  tolerant DTS reader, the tree walker, the overlay store, and fs-only tree
  discovery, exported as `@typecad/cuttlefish/board-catalog`. The create
  wizard uses it before any framework is installed; framework-zephyr
  consumes it and adds the spawn-based west cascade for explicit syncs.
- **Regen-first board modules**: `.cuttlefish/board.ts` + `board.json` are
  derived artifacts. Every build regenerates them when ANY input moves —
  the config's `board:` field, the catalog record, the tree provenance, or
  the extraction revision — via a source fingerprint stamped into
  board.json. A changed board in Zephyr or the config recreates the
  project's board artifacts on the next `cuttlefish build`, no command
  needed.
- **Catalogs self-heal**: builds create the machine-local overlay when
  missing and re-walk the tree when its VERSION/git HEAD/boards-mtime or
  the generator revision moves past the overlay's recorded provenance
  (fs-only checks; the 6s walk happens once per tree change, not per
  build). `cuttlefish board sync` remains the explicit, verbose form and
  now diffs against the PREVIOUS overlay (what changed in your tree).
- **Tests** resolve against a checked-in fixture overlay
  (`tests/fixtures/board-catalog.overlay.json`, ~75 boards generated from
  the pinned tree filtered to the ids the suites reference) instead of the
  pack — hermetic, and a few hundred lines instead of 102k.


## The installed SDK is the source of truth — `cuttlefish create` gates on it

The zephyr-installer bin is tightly integrated into the workspace, and a
project without a working SDK is useless — so create refuses to scaffold
one without it:

- **`cuttlefish create` checks the SDK first** (native-desktop targets
  excepted): a missing install fails with the exact installer command, and
  a tree that doesn't match the workspace pin (`v4.4.2`, SDK `1.0.1`)
  fails with re-pin guidance. The pin mirrors the installer's
  `versions.env`, and a drift-guard test keeps the two in lockstep.
- **SDK fingerprint** (`sdkFingerprint`: sha of the tree's VERSION + git
  HEAD) identifies the install everywhere — printed by `cuttlefish
  doctor` and `cuttlefish board sync` next to the pin.
- **The board registry builds from the installed SDK at create time**:
  create runs the catalog refresh before listing boards, so a fresh
  machine gets its registry (1,313 variants on the pinned tree) generated
  on demand — nothing ships pre-baked.
- **`$ZEPHYR_BASE` is authoritative** when set: an explicit pointer that
  isn't a tree is reported, not papered over with a well-known-workspace
  fallback (and it makes SDK-state tests deterministic on machines that
  have `~/zephyrproject`).
- `CUTTLEFISH_SDK_CHECK=off` bypasses the gate for experts tracking their
  own tree; the build-time compat range (`>=4.3 <5.0`) still applies.
