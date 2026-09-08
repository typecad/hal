// ---------------------------------------------------------------------------
// boardgen.ts — project-local board module generator.
//
// One path for every board: joins a board record — from the machine-local
// catalog (generated from the installed Zephyr SDK's tree) or from a
// CONTRACT (custom PCB spec) — and emits the two artifacts a project
// carries instead of a board package:
//
//   .typecad-hal/board.ts   — typed pin/bus/LED/BUTTON exports (the virtual
//                            '@typecad/hal' module resolves here via the
//                            project tsconfig — the single import surface)
//   .typecad-hal/board.json — the BoardConstants flat map (pins.all.*,
//                            peripherals.*, zephyr.*) the transpiler's
//                            resolveChipFromBoard reconstructs its chip
//                            view from
//
// All boards are equal: there is no curated descriptor tier. GPIO
// controller tables are DERIVED from the controller names present in the
// board's facts per vendor-family port conventions; the datasheet pin
// sweep enumerates those derived ranges; bus instances and the USB device
// controller come from the board's own &i2c/&spi/&uart/&usbd nodes.
// Silicon facts that never appear in devicetree (per-pin ADC channels, PWM
// matrices) are absent for every board alike.
//
// Pure: returns the file contents; the caller (cuttlefish config-loader via
// the strategy hook, or `typecad-hal board regen`) writes them.
// ----------------------------------------------------------------------------

import type { BoardDataEntry } from '@typecad/cuttlefish/board-catalog';
import { parseAsBuiltJson, type AsBuiltFile, type AsBuiltRoute } from './as-built.js';
import {
  loadBoardCatalogOverlay,
  GENERATOR_REV,
  boardRecordFingerprint,
  factsFingerprint,
  findBoardInCatalog,
  socBusLabelsFromTree,
} from '@typecad/cuttlefish/board-catalog';
import type { ZephyrGpioController, ZephyrProbeMethod } from './chips/types.js';
import { getBoardGateData } from '@typecad/cuttlefish/board-gate';

/** A generated pin: schematic name, JS-safe identifier, HAL number. */
interface GenPin {
  readonly name: string;
  readonly ident: string;
  readonly halPin: number;
}

export interface GeneratedBoard {
  readonly boardTs: string;
  readonly boardJson: string;
  /** The resolved board record (identifier/name/vendor) — for build notes. */
  readonly board: BoardDataEntry;
  /** Non-fatal notes from generation — user facts shadowing harvested
   *  routes (the user won; the harvest said otherwise). */
  readonly warnings?: readonly string[];
}

/**
 * The catalog lookups resolve against the local overlay — the user's own
 * Zephyr tree (`typecad-hal board sync`, auto-refreshed when the tree
 * moves). There is no compiled-in database: a machine with no tree and no
 * overlay has no boards, and the error below says exactly that.
 */
function activeBoardData(): Record<string, BoardDataEntry> {
  const data = loadBoardCatalogOverlay()?.data as Record<string, BoardDataEntry> | undefined;
  if (!data) {
    throw new Error(
      `No board catalog on this machine. The catalog is generated from your Zephyr tree —\n` +
      `run 'typecad-hal board sync' (or point TYPECAD_HAL_BOARD_CATALOG at a catalog file).`,
    );
  }
  return data;
}

/** Look up a board variant by qualified target or bare board id. */
export function findBoardData(target: string): BoardDataEntry | undefined {
  return findBoardInCatalog(activeBoardData(), target);
}

/** soc name from a qualified target ('board/soc/qual' → 'soc'). */
export function socOfTarget(target: string): string {
  const parts = target.split('/');
  return parts.length >= 2 ? parts[1] : '';
}

/**
 * nRF SAADC AIN→P0-pad map per SoC — [channel, pad] pairs (see the synthesis
 * block in buildModule for the verification trail). Undefined for SoCs
 * without a verified map (including every /cpunet variant: the nRF5340
 * network core declares no SAADC).
 */
export function nrfSaadcAinPads(soc: string, identifier: string): readonly [number, number][] | undefined {
  if (identifier.split('/').includes('cpunet')) return undefined;
  const table: Record<string, readonly [number, number][]> = {
    nrf52832: [[0, 2], [1, 3], [2, 4], [3, 5], [4, 28], [5, 29], [6, 30], [7, 31]],
    nrf52840: [[0, 2], [1, 3], [2, 4], [3, 5], [4, 28], [5, 29], [6, 30], [7, 31]],
    nrf5340: [[0, 4], [1, 5], [2, 6], [3, 7], [4, 25], [5, 26]],
    nrf9160: [[1, 14], [2, 15], [3, 16], [4, 17], [5, 18], [6, 19]],
    nrf9161: [[1, 14], [2, 15], [3, 16], [4, 17], [5, 18], [6, 19]],
    nrf9151: [[1, 14], [2, 15], [3, 16], [4, 17], [5, 18], [6, 19]],
  };
  return table[soc];
}

/**
 * ESP32 DAC channel→GPIO pad map per SoC — [channel, pad] pairs, silicon-
 * fixed (no pinctrl group; the DAC outputs through the RTC IO mux on a fixed
 * pad). Only the original ESP32 and the ESP32-S2 carry the 8-bit DAC; the
 * S3/C3/C6/H2 dropped it. Sourced from the HAL's dac_periph.c
 * (`dac_channel_io_num[]`), like the nRF SAADC table is from the PS.
 */
export function esp32DacPins(soc: string): readonly [number, number][] | undefined {
  const table: Record<string, readonly [number, number][]> = {
    esp32: [[0, 25], [1, 26]],
    esp32s2: [[0, 17], [1, 18]],
  };
  return table[soc];
}

function identOf(name: string): string {
  return name.replace(/\./g, '_').replace(/[^A-Za-z0-9_]/g, '_');
}

// ── Family analog config parameters ─────────────────────────────────────────
// The per-SoC channel-setup values the driver validates against. These are the
// "accompanying config parameters" that travel WITH the board's manifest —
// never per-SoC code in the lowering, because the driver rejects anything
// else at runtime. Sourced per family; a soc not listed keeps the lowering's
// default. (The coverage ledger tracks which families are still on defaults.)
const PWM_CLOCK_HZ: Record<string, number> = {
  // STM32F411: 100 MHz sysclk, APB1 50×2 = APB2 100 → every timer 100 MHz.
  stm32f411: 100_000_000,
  // STM32F401: all-84 clock tree.
  stm32f401: 84_000_000,
};

/** ADC channel-setup gain/reference pair per soc-family prefix. */
const ADC_CHANNEL_CFG: Record<string, { gain: string; reference: string }> = {
  // STM32's adc driver rejects any gain but ADC_GAIN_1 ("Invalid channel
  // gain", -EINVAL) and maps ADC_REF_INTERNAL to the VREF+ pad.
  stm32: { gain: 'ADC_GAIN_1', reference: 'ADC_REF_INTERNAL' },
  // adc_rpi_pico.c hard-rejects any gain but 1 ("Gain is not valid") — 12-bit
  // against VDD, hence REF_VDD_1 + the 3300 mV vref below.
  rp2040: { gain: 'ADC_GAIN_1', reference: 'ADC_REF_VDD_1' },
  rp2350: { gain: 'ADC_GAIN_1', reference: 'ADC_REF_VDD_1' },
};

/**
 * Pin-naming convention for a board, from its soc name — the same families
 * the vendor port conventions encode, with no hand-maintained data:
 * nRF uses P<port>.<bit>, Raspberry Pi GP<N>, Espressif GPIO<N>, and every
 * other family uses the controller's own port letters/digits.
 */
type NamingConv = 'nrf-port' | 'rp-gpio' | 'esp32-gpio' | 'family';
function namingConvFor(soc: string): NamingConv {
  const s = soc.toLowerCase();
  if (/^nrf5|^nrf9/.test(s)) return 'nrf-port';
  if (/^rp2/.test(s)) return 'rp-gpio';
  if (/^esp32/.test(s)) return 'esp32-gpio';
  return 'family';
}

/**
 * Controller names that are I2C/SPI GPIO expanders, not the SoC's GPIO.
 * Pins behind them ride the devicetree alias path (LED/BUTTON dtSpecs) and
 * cannot be placed on the HAL pin map — exclude them from the derived
 * controller table and from pin placement.
 */
function isExpanderController(name: string): boolean {
  return /^(gpio_exp\d+|sx1509b|mfx|cy8c95xx_port\d+)$/.test(name);
}

/**
 * Port-block range for a DTS GPIO controller name, per the vendor family's
 * port convention. Widths are pinned empirically against the board catalog
 * (max observed bit per family): Renesas RA `ioport<N>` ports are 16 bits
 * with letters continuing past ioport9 (a = port 10); Atmel
 * `port<letter>`/`pio<letter>` are 32-bit ports; Cypress `gpio_prt<N>` are
 * 8-bit ports; Ambiq Apollo splits banks into range-encoded `gpio<lo>_<hi>`
 * nodes; bare `gpio<digit>` is the nRF/ESP-style 32-pin controller. The
 * `gpio<letter>` ports are handled by the caller (deriveControllers) —
 * their width is fact-driven, not derivable from the name alone. Returns
 * undefined when the name encodes no derivable range.
 */
function controllerRangeFor(name: string): ZephyrGpioController | undefined {
  const A = 'a'.charCodeAt(0);
  const letterIndex = (ch: string) => ch.charCodeAt(0) - A;
  let m = name.match(/^gpio(\d+)_(\d+)$/); // Ambiq gpio0_31, gpio96_127
  if (m) return { nodelabel: name, minPin: parseInt(m[1], 10), maxPin: parseInt(m[2], 10) };
  m = name.match(/^gpio([a-z])_(\d+)_(\d+)$/); // SiFli gpioa_00_31, gpioa_32_44
  if (m) return { nodelabel: name, minPin: parseInt(m[2], 10), maxPin: parseInt(m[3], 10) };
  m = name.match(/^gpio(\d+)x(\d+)x$/); // NXP KB combined banks gpio0x1x
  if (m) {
    return { nodelabel: name, minPin: parseInt(m[1], 10) * 32, maxPin: parseInt(m[2], 10) * 32 + 31 };
  }
  m = name.match(/^gpio_prt(\d+)$/); // Cypress/Infineon 8-pin ports
  if (m) {
    const base = parseInt(m[1], 10) * 8;
    return { nodelabel: name, minPin: base, maxPin: base + 7 };
  }
  m = name.match(/^ioport(\d+)$/); // Renesas RA 16-pin ports
  if (m) {
    const base = parseInt(m[1], 10) * 16;
    return { nodelabel: name, minPin: base, maxPin: base + 15 };
  }
  m = name.match(/^ioport([a-z])$/); // RA ports past 9 (a = port 10)
  if (m) {
    const base = (10 + letterIndex(m[1])) * 16;
    return { nodelabel: name, minPin: base, maxPin: base + 15 };
  }
  m = name.match(/^(?:port|pio)([a-z])$/); // Atmel SAM 32-pin ports
  if (m) {
    const base = letterIndex(m[1]) * 32;
    return { nodelabel: name, minPin: base, maxPin: base + 31 };
  }
  m = name.match(/^gpio([a-z])_(l|h)$/); // NXP MCX/S32K low/high register banks
  if (m) {
    const base = letterIndex(m[1]) * 32 + (m[2] === 'h' ? 16 : 0);
    return { nodelabel: name, minPin: base, maxPin: base + 15 };
  }
  m = name.match(/^gpio_([a-z])$/); // NXP MCX gpio_a — 32-pin ports
  if (m) {
    const base = letterIndex(m[1]) * 32;
    return { nodelabel: name, minPin: base, maxPin: base + 31 };
  }
  m = name.match(/^gpioa(\d+)$/); // TI CC32xx gpioa0…
  if (m) {
    const base = parseInt(m[1], 10) * 32;
    return { nodelabel: name, minPin: base, maxPin: base + 31 };
  }
  m = name.match(/^mcu_gpio(\d+)$/); // TI K3 MCU domain — offset past the main domain space
  if (m) {
    const base = 256 + parseInt(m[1], 10) * 32;
    return { nodelabel: name, minPin: base, maxPin: base + 31 };
  }
  m = name.match(/^gpio(\d+)_hi$/); // RP2350B high bank (gpio0_hi = pins 32…)
  if (m) {
    const base = (parseInt(m[1], 10) + 1) * 32;
    return { nodelabel: name, minPin: base, maxPin: base + 31 };
  }
  m = name.match(/^(?:main_)?gpio(\d+)$/); // nRF/ESP/RP + TI main domain
  if (m) {
    const base = parseInt(m[1], 10) * 32;
    return { nodelabel: name, minPin: base, maxPin: base + 31 };
  }
  m = name.match(/^hsgpio(\d+)$/); // RW612
  if (m) {
    const base = parseInt(m[1], 10) * 32;
    return { nodelabel: name, minPin: base, maxPin: base + 31 };
  }
  m = name.match(/^psgpio_bank(\d+)$/); // Zynq PS banks
  if (m) {
    const base = parseInt(m[1], 10) * 32;
    return { nodelabel: name, minPin: base, maxPin: base + 31 };
  }
  if (name === 'gpio') {
    // Flat single-controller boards (musca, neorv32, quicklogic).
    return { nodelabel: name, minPin: 0, maxPin: 31 };
  }
  return undefined;
}

/**
 * GPIO controller table for a board: derived from the controller names
 * present in the board's facts per vendor-family port conventions. Names
 * that encode no derivable range but are real controllers (the MPS2
 * boards' dedicated gpio_led0/gpio_button FPGAIO IPs, the Pi 5's gio_aon
 * bank) get opaque high bases — collision-free by construction, and
 * LED/BUTTON ride the devicetree alias path anyway. Expanders are excluded
 * (isExpanderController). Returns the table plus the OPAQUE controller
 * names (excluded from the datasheet pin sweep).
 */
function deriveControllers(entry: BoardDataEntry): { controllers: ZephyrGpioController[]; opaque: Set<string> } {
  // controller → highest bit any fact places on it
  const maxBits = new Map<string, number>();
  const note = (controller: string, pin: number) => {
    if (isExpanderController(controller)) return;
    maxBits.set(controller, Math.max(maxBits.get(controller) ?? -1, pin));
  };
  if (entry.led) note(entry.led.controller, entry.led.pin);
  if (entry.button) note(entry.button.controller, entry.button.pin);
  // Silicon routes: the board's own DTS includes its PACKAGE-specific
  // pinctrl file (stm32f411c(c-e)ux-pinctrl.dtsi — the (c-e)ux package), so
  // a harvested route is the board declaring that pad exists — the same
  // board-equal standing as a led fact, not curated data. Without this, a
  // port no led/button/connector happens to sit on exports no PWM/ADC
  // routes (the blackpill lost 12 of 30 PWM routes and PB's ADC channels
  // to exactly this).
  for (const r of [...(entry.pwmPins ?? []), ...(entry.adcPins ?? []), ...(entry.dacPins ?? [])]) {
    note(`gpio${r.port.toLowerCase()}`, r.bit);
  }
  // ESP32 numbered-GPIO family: routes carry global pads (no port letters);
  // the gpio0 convention covers 0-48 on these SoCs.
  for (const r of (entry.espAdc ?? []).map((x) => x.pad).concat(entry.pwmMatrix?.pads ?? [])) {
    note('gpio0', r);
  }
  if (entry.stripLed) note(entry.stripLed.controller, entry.stripLed.pin);
  for (const c of entry.extraLeds ?? []) note(c.controller, c.pin);
  for (const c of entry.extraButtons ?? []) note(c.controller, c.pin);
  for (const conn of entry.connectors ?? []) {
    for (const ref of Object.values(conn.pins)) note(ref.controller, ref.pin);
  }
  // Overlay io-channel wiring contributes the same standing: the overlay's
  // gpio-map is the board author declaring those pads (Renesas RA boards
  // carry their ENTIRE connector only in board-dir overlays).
  for (const r of entry.connectorAdc ?? []) note(r.controller, r.pin);

  // ── SoC gpio-controller inventory (the "every pad" source) ──────────────
  // Seed the table with EVERY controller the SoC dtsi declares, so a port the
  // board's own facts never name still sweeps its full range. The board-fact
  // `note` calls above refine widths (a bit ≥ 16 widens a letter port);
  // `ngpios`, when the dtsi states one, provides the baseline width for
  // families whose port convention isn't derivable from the name alone.
  for (const c of entry.gpioControllers ?? []) {
    if (isExpanderController(c.nodelabel)) continue;
    if (maxBits.has(c.nodelabel)) continue;
    maxBits.set(c.nodelabel, c.ngpios !== undefined ? c.ngpios - 1 : 0);
  }

  const derived: ZephyrGpioController[] = [];
  const opaque = new Set<string>();

  // Letter-port family (gpioa…gpiop): STM32-class ports are 16 bits wide,
  // but several vendors reuse the same controller names with 32-bit ports
  // (TI MSPM0 gpiob.22, NXP Kinetis gpioe.31, OpenISA RV32M1 gpioa.31). A
  // hard-coded 16-wide range placed those bits outside every controller
  // range, and the raw-GPIO lowering then fell back to a nonexistent
  // `gpio0` nodelabel (undefined `__device_dts_ord_…` at C++ compile time).
  // Size each port 32 bits when an observed fact uses bit ≥ 16, and hand
  // out bases sequentially so a widened port never overlaps its neighbours
  // (boards whose facts all sit at bits ≤ 15 keep the 16-wide letterIndex
  // numbering; contiguous-from-a boards reproduce it exactly).
  let letterBase = 0;
  for (const name of [...maxBits.keys()].filter((n) => /^gpio[a-p]$/.test(n)).sort()) {
    const width = (maxBits.get(name) ?? 0) >= 16 ? 32 : 16;
    derived.push({ nodelabel: name, minPin: letterBase, maxPin: letterBase + width - 1 });
    letterBase += width;
  }

  for (const name of maxBits.keys()) {
    if (/^gpio[a-p]$/.test(name)) continue;
    const range = controllerRangeFor(name);
    if (range) derived.push(range);
    else opaque.add(name);
  }
  // Opaque controllers: deterministic sequential slots far above any
  // derived range so HAL pin numbers never collide.
  [...opaque].sort().forEach((name, i) => {
    derived.push({ nodelabel: name, minPin: 4096 + i * 32, maxPin: 4096 + i * 32 + 31 });
  });
  derived.sort((a, b) => a.minPin - b.minPin);
  return { controllers: derived, opaque };
}

/**
 * Pin name + HAL number for a (controller, bit) fact, consistent with the
 * derived controller table's numbering. Family-aware per the board's
 * naming convention: ioport1.3 → P103, gpio0_31.5 → GPIO5, porta.23 →
 * PA23, gpio_prt5.6 → P5_6, gpio0.26 → GPIO26 (or P0.26 on nRF / GP26 on
 * RP2040 per the soc's convention). Undefined when the controller is an
 * expander or encodes no range and has no opaque slot.
 */
function placePin(
  conv: NamingConv,
  ref: { controller: string; pin: number },
  table: ZephyrGpioController[],
): GenPin | undefined {
  if (isExpanderController(ref.controller)) return undefined;
  const ctrl = table.find((c) => c.nodelabel === ref.controller);
  if (!ctrl) return undefined;
  const placed = (name: string): GenPin => ({ name, ident: identOf(name), halPin: ctrl.minPin + ref.pin });
  // Range-encoded families (Ambiq gpio0_31, SiFli gpioa_00_31): the bit is
  // the global pin offset by the range base.
  if (/^gpio[a-z]?_\d+_\d+$/.test(ref.controller)) return placed(`GPIO${ctrl.minPin + ref.pin}`);
  if (ref.controller === 'gpio') return placed(`GPIO${ref.pin}`);
  let m = ref.controller.match(/^ioport([0-9]|[a-z])$/);
  if (m) {
    const port = /[0-9]/.test(m[1]) ? m[1] : String(10 + m[1].charCodeAt(0) - 'a'.charCodeAt(0));
    return placed(`P${port}${String(ref.pin).padStart(2, '0')}`);
  }
  // Letter-port families (Atmel porta/pioa, NXP gpio_a, STM32 gpioc) and
  // the MCX/S32K low/high register banks (gpioc_h.0 → PC16).
  m = ref.controller.match(/^(?:port|pio)([a-z])$/);
  if (m) return placed(`P${m[1].toUpperCase()}${ref.pin}`);
  m = ref.controller.match(/^gpio_?([a-p])$/);
  if (m) return placed(`P${m[1].toUpperCase()}${ref.pin}`);
  m = ref.controller.match(/^gpio([a-z])_(l|h)$/);
  if (m) return placed(`P${m[1].toUpperCase()}${(m[2] === 'h' ? 16 : 0) + ref.pin}`);
  m = ref.controller.match(/^gpio_prt(\d+)$/);
  if (m) return placed(`P${m[1]}_${ref.pin}`);
  m = ref.controller.match(/^gpioa(\d+)$/);
  if (m) return placed(`PA${m[1]}${ref.pin}`);
  // Digit controllers (gpio0, gpio0_hi, main_gpio0, gpio0x1x, hsgpio…):
  // the HAL number is the global pin (base + bit), named per the soc's
  // convention — nRF P0.05, RP2040 GP5, Espressif/everything else GPIO5.
  if (/gpio\d/.test(ref.controller)) {
    if (conv === 'nrf-port') {
      const port = (ctrl.minPin / 32) | 0;
      return placed(`P${port}.${String(ref.pin).padStart(2, '0')}`);
    }
    if (conv === 'rp-gpio') return placed(`GP${ctrl.minPin + ref.pin}`);
    return placed(`GPIO${ctrl.minPin + ref.pin}`);
  }
  // Opaque controllers (gpio_led0, gio_aon, …): generic label-based name.
  const letters = ref.controller.replace(/[^a-z]/gi, '').toUpperCase().replace('GPIO', '');
  const name = letters.length > 0 ? `P${letters}${ref.pin}` : `${ref.controller.toUpperCase()}${ref.pin}`;
  return placed(name);
}

/**
 * Parse a datasheet pin name into (controller nodelabel, controller-relative
 * bit) per the soc's naming family — the inverse of the sweep naming:
 *   nRF      P0.28 / P0_28 → gpio0.28
 *   RP2040   GP25          → gpio0.25
 *   ESP32    GPIO9         → gpio0.9 (GPIO32+ → gpio1.x)
 *   letters  PA5 / PB6     → gpioa.5 / gpiob.6
 *   flat     GPIO9 (non-esp32 socs, single flat controller) → gpio.9
 */
export function parsePinName(soc: string, name: string): { controller: string; pin: number } | undefined {
  const conv = namingConvFor(soc);
  const n = name.trim().toUpperCase();
  let m = n.match(/^P(\d)\.(\d{1,2})$/);
  if (conv === 'nrf-port' && m) return { controller: `gpio${m[1]}`, pin: Number(m[2]) };
  m = n.match(/^GP(\d{1,2})$/);
  if (conv === 'rp-gpio' && m) return { controller: 'gpio0', pin: Number(m[1]) };
  m = n.match(/^GPIO(\d{1,2})$/);
  if (m) {
    const num = Number(m[1]);
    if (conv === 'esp32-gpio') return { controller: num < 32 ? 'gpio0' : 'gpio1', pin: num < 32 ? num : num - 32 };
    return { controller: 'gpio', pin: num };
  }
  m = n.match(/^P([A-Pa-p])(\d{1,2})$/);
  if (m) return { controller: `gpio${m[1].toLowerCase()}`, pin: Number(m[2]) };
  return undefined;
}

/**
 * Build the board module contents from one board record. This is the one
 * builder for every kind of board: catalog records (from the local overlay
 * generated off the installed SDK's tree) and contract records (custom PCB
 * specs) both route through here.
 */
// ── User facts (typecad-hal.facts.json) ──────────────────────────────────────
// The project-local escape hatch: facts the pipeline has not (or cannot)
// harvest, declared per board and merged into the manifest BEFORE anything
// else runs — board module exports, capability flags, validation, lowering
// and the overlay all see them as first-class facts. User routes win per
// PIN over harvested ones (a warning records every shadowing); pins are the
// same global numbers the generated module and diagnostics use.

/** One board's user-declared facts — the `boards['<target>']` section. */
export interface UserBoardFacts {
  adc?: {
    /** DT nodelabel of the ADC device (default: the board's primary, or 'adc'). */
    device?: string;
    channels: { pin: number; channel: number; pinctrl?: string }[];
  };
  pwm?: {
    /** Static specs — pin→controller/channel. Suppresses the auto nRF matrix. */
    specs: { pin: number; controller: string; channel: number; pinctrl?: string }[];
  };
  dac?: {
    device: string;
    channels: { pin: number; channel: number; resolution?: number }[];
  };
}

/** The whole typecad-hal.facts.json shape. */
export interface UserFactsFile {
  boards: Record<string, UserBoardFacts>;
}

/** Parse + shape-validate the facts file; a clear error names the file. */
export function parseUserFactsJson(text: string, source = 'typecad-hal.facts.json'): UserFactsFile {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    throw new Error(`${source} is not valid JSON: ${(err as Error).message}`);
  }
  const file = parsed as UserFactsFile;
  if (!file || typeof file !== 'object' || !file.boards || typeof file.boards !== 'object') {
    throw new Error(`${source} must carry a top-level "boards" object keyed by board target.`);
  }
  for (const [key, facts] of Object.entries(file.boards)) {
    if (facts.adc && !Array.isArray(facts.adc.channels)) {
      throw new Error(`${source}: boards['${key}'].adc.channels must be an array.`);
    }
    if (facts.pwm && !Array.isArray(facts.pwm.specs)) {
      throw new Error(`${source}: boards['${key}'].pwm.specs must be an array.`);
    }
    if (facts.dac && (!facts.dac.device || !Array.isArray(facts.dac.channels))) {
      throw new Error(`${source}: boards['${key}'].dac needs a device and a channels array.`);
    }
  }
  return file;
}

/** The section matching a target — the same exact → lowercase → prefix
 *  leniency findBoardData applies to catalog keys. */
export function userFactsForTarget(file: UserFactsFile | undefined, target: string): UserBoardFacts | undefined {
  if (!file) return undefined;
  const keys = Object.keys(file.boards);
  const hit = keys.find((k) => k === target)
    ?? keys.find((k) => k.toLowerCase() === target.toLowerCase())
    ?? keys.find((k) => target.startsWith(k) || k.startsWith(target));
  return hit ? file.boards[hit] : undefined;
}

export function buildModule(
  entry: BoardDataEntry,
  userFacts?: UserBoardFacts,
  factsSuffix = '',
  seedWarnings: readonly string[] = [],
): GeneratedBoard {
  // The ungated surface is derived from the project's own hal copy — same
  // resolution (project → cwd → monorepo sibling) as the engine's HAL parser.
  const { ungated: BOARD_UNGATED_EXPORTS, ungatedTypes: BOARD_UNGATED_TYPE_EXPORTS } = getBoardGateData();
  const soc = socOfTarget(entry.identifier);
  const conv = namingConvFor(soc);

  // ── Controller table + datasheet sweep (the same for every board) ──────
  const { controllers, opaque } = deriveControllers(entry);

  // ── Silicon PWM/analog routes (SoC pinctrl harvest) ────────────────────
  // Raw port/bit routes from the catalog (STM32 vendor-HAL pinctrl dtsi;
  // matrix/arithmetic families — ESP32 LEDC, RP2040 slices — ship no
  // pwmPins and remain family conventions). A route survives only when its
  // pad's controller is in the derived table: a port the board's facts
  // never reference is not exported, silicon route or not — all boards
  // equal. First timer per pad wins (lowest timer number, then channel).
  const globalForPort = (port: string, bit: number): number | undefined => {
    // Letter-port controller naming varies by vendor: STM32/sam0 styles are
    // gpio<letter> (gpioa), Atmel SAM's is port<letter> (porta) — both are
    // the same letter-port convention, matched by whatever the derived
    // table actually contains.
    const lower = port.toLowerCase();
    const ctrl = controllers.find((c) => c.nodelabel === `gpio${lower}` || c.nodelabel === `port${lower}`);
    // The harvested bit is PORT-RELATIVE (PB6 → bit 6), so the guard is the
    // controller's width, not its global range — a `bit >= minPin` check
    // silently dropped every route on any port after the first.
    return ctrl && bit >= 0 && bit <= ctrl.maxPin - ctrl.minPin ? ctrl.minPin + bit : undefined;
  };
  const siliconPwm: { pin: number; controller: string; channel: number; pinctrl?: string }[] = [];
  const pwmSeenPad = new Set<number>();
  for (const p of [...(entry.pwmPins ?? [])].sort((a, b) =>
    a.source.localeCompare(b.source, undefined, { numeric: true }) || a.channel - b.channel)) {
    // The route's controller: STM32 spells the pinctrl source `tim{N}` with
    // the DT convention mapping onto the `pwm{N}` child under `timers{N}`;
    // every other family harvested so far (Kinetis `ftmN`, LPC `ctimerN`,
    // GD32 `timerN`, i.MX `flexpwmN_pwmK`) uses the DT controller label
    // VERBATIM as the source.
    const timer = p.source.match(/^tim(\d+)$/);
    const controller = timer ? `pwm${timer[1]}` : p.source;
    if (!controller) continue;
    const pin = globalForPort(p.port, p.bit);
    if (pin === undefined || pwmSeenPad.has(pin)) continue;
    pwmSeenPad.add(pin);
    siliconPwm.push({ pin, controller, channel: p.channel, pinctrl: p.pinctrl });
  }
  // Cross-check: only routes whose source DEVICE the SoC declares (a
  // pinctrl file can carry routes for peripherals the dtsi never defines).
  // EVERY declared controller contributes its routes — STM32 adc1/adc2 (and
  // adc3 on bigger parts) share channel indices per controller, so each
  // route carries its owning controller. The primary (first sorted) source
  // is the descriptor's nodeLabel; its channels omit the controller field
  // so a single-controller manifest is unchanged.
  const analogDevices = new Set(entry.analogDevices ?? []);
  // Digitless single-controller pinctrl spelling (STM32 f0/l0/l1/wl write
  // `adc_in0_pa0`) maps onto the device label the SoC dtsi actually
  // declares (`adc1`), so the cross-check and the nodeLabel stay honest.
  const adcDeviceLabels = [...analogDevices].filter((d) => /^adc/.test(d)).sort();
  const adcRoutes = (entry.adcPins ?? []).map((a) =>
    a.source === 'adc' && adcDeviceLabels.length > 0 ? { ...a, source: adcDeviceLabels[0] } : a,
  );
  const adcSources = [...new Set(adcRoutes.map((a) => a.source))]
    .filter((src) => analogDevices.size === 0 || analogDevices.has(src)).sort();
  const siliconAdc: { pin: number; channel: number; controller?: string; pinctrl?: string }[] = [];
  const adcSeenPad = new Set<number>();
  for (const a of adcRoutes
    .filter((x) => adcSources.includes(x.source))
    .sort((x, y) => x.source.localeCompare(y.source, undefined, { numeric: true }) || x.channel - y.channel)) {
    const pin = globalForPort(a.port, a.bit);
    if (pin === undefined || adcSeenPad.has(pin)) continue;
    adcSeenPad.add(pin);
    siliconAdc.push({
      pin,
      channel: a.channel,
      ...(a.source !== adcSources[0] ? { controller: a.source } : {}),
      ...(a.pinctrl ? { pinctrl: a.pinctrl } : {}),
    });
  }
  // ESP32 SARADC routes (pad form, no pinctrl groups — the pads are analog
  // by silicon). Same every-declared-unit rule: each unit's routes carry the
  // unit as their controller; the first unit stays the implicit primary.
  const espAdcUnits = [...new Set((entry.espAdc ?? []).map((r) => r.source))]
    .filter((src) => analogDevices.size === 0 || analogDevices.has(src)).sort();
  const espAdcUnit = espAdcUnits[0];
  for (const r of [...(entry.espAdc ?? [])]
    .filter((x) => espAdcUnits.includes(x.source))
    .sort((x, y) => x.source.localeCompare(y.source, undefined, { numeric: true }) || x.channel - y.channel)) {
    const ctrl = controllers.find((c) => c.nodelabel === 'gpio0');
    if (!ctrl || r.pad > ctrl.maxPin - ctrl.minPin) continue;
    siliconAdc.push({
      pin: ctrl.minPin + r.pad,
      channel: r.channel,
      ...(r.source !== espAdcUnit ? { controller: r.source } : {}),
    });
  }
  // nRF SAADC: Nordic silicon has no per-pad ADC devicetree — the AIN
  // index IS the driver channel and its pad is silicon-fixed (the XIAO's
  // board DTS carries no ADC node at all). Family tables, same shape as
  // PWM_CLOCK_HZ, all verified against the in-tree DK io-channel-map
  // comments. Entries with no agreeing in-tree source are OMITTED, not
  // guessed — a missing channel just leaves that pad non-analog in the
  // facts:
  //   nrf52832/nrf52840: AIN0-7 = P0.02-P0.05, P0.28-P0.31 (nrf52840dk,
  //     nrf52dk; AIN0/AIN3 complete the P0.02-P0.05 block per the PS).
  //   nrf5340: AIN0-5 = P0.04-P0.07, P0.25-P0.26 (nrf5340dk, nrf7002dk).
  //     AIN6/AIN7 pads have no agreeing source — the audio DK's comments
  //     conflict with both DKs — omitted until verified. App core only:
  //     the netcore dtsi declares no SAADC.
  //   nrf9160/nrf9161/nrf9151: AIN1-6 = P0.14-P0.19 (nrf9160dk, nrf9161dk,
  //     nrf9151dk — three independent boards agree). AIN0/AIN7 pads are
  //     undocumented in-tree — omitted.
  // nRF54L declares no nordic,nrf-saadc node (VND SAADC) — a separate
  // driver/channel shape, follow-up.
  const nrfSaadc = nrfSaadcAinPads(soc, entry.identifier);
  let nrfSaadcSynth = false;
  if (siliconAdc.length === 0 && espAdcUnits.length === 0 && nrfSaadc) {
    const gpio0 = controllers.find((c) => c.nodelabel === 'gpio0');
    for (const [channel, pad] of nrfSaadc) {
      if (gpio0 && pad > gpio0.maxPin - gpio0.minPin) continue;
      siliconAdc.push({ pin: (gpio0?.minPin ?? 0) + pad, channel });
    }
    nrfSaadcSynth = siliconAdc.length > 0;
    if (nrfSaadcSynth) adcSources.push('adc');
  }
  // RP2 header-matrix routes (rpi-pico-*-pinctrl.h macros): GLOBAL pad
  // numbers (the macro's P<n>), pinmux-macro tokens for the overlay's
  // pinctrl groups (both the ADC and PWM drivers apply pinctrl on RP2). A
  // pad may live on ANY controller — the RP2350B's ADC macros sit on pads
  // 40-43 (gpio1 territory), so a gpio0-only check silently dropped them.
  const padToPin = (pad: number): number | undefined =>
    controllers.find((c) => pad >= c.minPin && pad <= c.maxPin) ? pad : undefined;
  for (const r of entry.padAdc ?? []) {
    const pin = padToPin(r.pad);
    if (pin === undefined) continue;
    if (adcSeenPad.has(pin)) continue;
    adcSeenPad.add(pin);
    siliconAdc.push({ pin, channel: r.channel, pinctrl: r.pinctrl });
    if (!adcSources.includes(r.source)) adcSources.push(r.source);
  }
  for (const r of entry.padPwm ?? []) {
    const pin = padToPin(r.pad);
    if (pin === undefined) continue;
    if (pwmSeenPad.has(pin)) continue;
    pwmSeenPad.add(pin);
    siliconPwm.push({ pin, controller: r.source, channel: r.channel, pinctrl: r.pinctrl });
  }
  // Connector io-channel wiring (the DKs' A0-A5 ↔ AIN maps): the last
  // fallback for boards on SoCs without a family table or a harvested
  // route — the channels the BOARD actually wires, by its own authorship.
  if (siliconAdc.length === 0 && (entry.connectorAdc ?? []).length > 0) {
    for (const r of entry.connectorAdc ?? []) {
      const ctrl = controllers.find((c) => c.nodelabel === r.controller);
      if (!ctrl || r.pin > ctrl.maxPin - ctrl.minPin) continue;
      const pin = ctrl.minPin + r.pin;
      if (adcSeenPad.has(pin)) continue;
      adcSeenPad.add(pin);
      siliconAdc.push({ pin, channel: r.channel });
      if (!adcSources.includes(r.source)) adcSources.push(r.source);
    }
  }
  // User facts (typecad-hal.facts.json) — the escape hatch. User routes win
  // PER PIN over every harvested source above, and each takeover is warned.
  // Seeded with the pinctrl harvest's own lint results (name↔value
  // disagreements — routes dropped as untrustworthy upstream of here).
  const userWarnings: string[] = [...(entry.pinctrlWarnings ?? []), ...seedWarnings];
  // pwm specs: run after ALL pwm sources (STM32 harvest, RP2 header
  // matrices) so every shadow — any family — lands in the warnings. Any
  // user pwm spec also suppresses the auto nRF matrix below (the
  // siliconPwm gate): the user owns pwm on that board.
  if (userFacts?.pwm) {
    for (const u of userFacts.pwm.specs) {
      const shadowed = siliconPwm.findIndex((x) => x.pin === u.pin);
      if (shadowed >= 0) {
        const old = siliconPwm[shadowed]!;
        userWarnings.push(
          `pwm pin ${u.pin}: user spec (${u.controller} ch ${u.channel}) shadows the harvested route (${old.controller} ch ${old.channel}).`,
        );
        siliconPwm.splice(shadowed, 1);
      }
      pwmSeenPad.add(u.pin);
      siliconPwm.push({ pin: u.pin, controller: u.controller, channel: u.channel, ...(u.pinctrl ? { pinctrl: u.pinctrl } : {}) });
    }
  }
  // adc channels: same rule across pinctrl harvest, headers, family tables,
  // connector wiring. The declared device (or the existing primary, or
  // 'adc') joins adcSources so the nodeLabel and the init blocks stay
  // consistent; on a board with NO harvested adc at all the user's device
  // IS the primary.
  if (userFacts?.adc) {
    const device = userFacts.adc.device ?? adcSources[0] ?? 'adc';
    if (!adcSources.includes(device)) adcSources.push(device);
    for (const u of userFacts.adc.channels) {
      const shadowed = siliconAdc.findIndex((x) => x.pin === u.pin);
      if (shadowed >= 0) {
        const old = siliconAdc[shadowed]!;
        userWarnings.push(`adc pin ${u.pin}: user channel ${u.channel} shadows the harvested channel ${old.channel}.`);
        siliconAdc.splice(shadowed, 1);
      }
      adcSeenPad.add(u.pin);
      siliconAdc.push({
        pin: u.pin,
        channel: u.channel,
        ...(device !== adcSources[0] ? { controller: device } : {}),
        ...(u.pinctrl ? { pinctrl: u.pinctrl } : {}),
      });
    }
  }
  const dacSources = [...new Set((entry.dacPins ?? []).map((d) => d.source))]
    .filter((src) => analogDevices.has(src)).sort();
  const siliconDac: { pin: number; channel: number; pinctrl: string }[] = [];
  for (const d of [...(entry.dacPins ?? [])]
    .filter((x) => x.source === dacSources[0])
    .sort((x, y) => x.channel - y.channel)) {
    const pin = globalForPort(d.port, d.bit);
    if (pin === undefined) continue;
    siliconDac.push({ pin, channel: d.channel, pinctrl: d.pinctrl });
  }
  // ESP32 DAC: silicon-fixed channel→pad (no pinctrl group, no harvested
  // route). Only when no pinctrl DAC was harvested and the soc has the DAC.
  const esp32Dac = esp32DacPins(soc);
  if (siliconDac.length === 0 && esp32Dac) {
    const gpio0 = controllers.find((c) => c.nodelabel === 'gpio0');
    for (const [channel, pad] of esp32Dac) {
      if (gpio0 && pad > gpio0.maxPin - gpio0.minPin) continue;
      siliconDac.push({ pin: (gpio0?.minPin ?? 0) + pad, channel, pinctrl: '' });
    }
    if (siliconDac.length > 0 && !dacSources.includes('dac')) dacSources.push('dac');
  }
  // User facts (typecad-hal.facts.json): dac channels win per pin, and the
  // declared device joins the sources (no analogDevices cross-check — the
  // user vouches for it).
  if (userFacts?.dac) {
    if (!dacSources.includes(userFacts.dac.device)) dacSources.push(userFacts.dac.device);
    for (const u of userFacts.dac.channels) {
      const shadowed = siliconDac.findIndex((x) => x.pin === u.pin);
      if (shadowed >= 0) {
        userWarnings.push(`dac pin ${u.pin}: user channel ${u.channel} shadows the harvested channel ${siliconDac[shadowed]!.channel}.`);
        siliconDac.splice(shadowed, 1);
      }
      siliconDac.push({ pin: u.pin, channel: u.channel, pinctrl: '' });
    }
  }
  const siliconPwmPins = new Set(siliconPwm.map((s) => s.pin));
  const siliconAdcPins = new Set(siliconAdc.map((s) => s.pin));
  const siliconDacPins = new Set(siliconDac.map((s) => s.pin));

  // ── Hardware counters (Zephyr counter devices) ─────────────────────────
  // Kernel-claim exclusions — counter nodes the system tick owns are NOT
  // free; a family table, like the letter-port conventions: the ESP32
  // esp_timer (espressif,esp32-rtc-timer) always belongs to the kernel, and
  // nRF's RTC0 is the default system clock (RTC1+ are free). STM32 has no
  // exclusion — Cortex-M SysTick is the tick, so the RTC is free.
  const KERNEL_CLAIMED: readonly { compatible?: string; nodeLabel?: string }[] = [
    { compatible: 'espressif,esp32-rtc-timer' },
    { compatible: 'nordic,nrf-rtc', nodeLabel: 'rtc0' },
  ];
  const isKernelClaimed = (n: { compatible: string; nodeLabel?: string }): boolean =>
    KERNEL_CLAIMED.some((k) =>
      (k.compatible === undefined || k.compatible === n.compatible)
      && (k.nodeLabel === undefined || k.nodeLabel === n.nodeLabel));
  const hwtimerControllers = (entry.counterNodes ?? []).filter((n) => !isKernelClaimed(n));

  const pins: GenPin[] = [];
  const byIdent = new Map<string, GenPin>();
  const pushPin = (p: GenPin | undefined): GenPin | undefined => {
    if (!p) return undefined;
    const existing = byIdent.get(p.ident);
    if (existing) return existing;
    byIdent.set(p.ident, p);
    pins.push(p);
    return p;
  };
  // Datasheet sweep: enumerate every derived (non-opaque) controller
  // range. Opaque controllers (FPGAIO IPs, AON banks) carry no sweepable
  // silicon layout — their facts still place through placePin below.
  for (const ctrl of controllers) {
    if (opaque.has(ctrl.nodelabel)) continue;
    const span = ctrl.maxPin - ctrl.minPin + 1;
    for (let bit = 0; bit < span; bit++) pushPin(placePin(conv, { controller: ctrl.nodelabel, pin: bit }, controllers));
  }

  // Connector pins from the record (labels like D0/D10, or contract pads).
  // A bit beyond the controller's declared width (the m5stack_fire DTS
  // wires grove p1 to gpio1.21 — a pad classic ESP32 does not have) is
  // unplaceable: skip it rather than mint a pin no lowering can route.
  const connectorExports: { label: string; pin: GenPin }[] = [];
  for (const conn of entry.connectors ?? []) {
    for (const [label, ref] of Object.entries(conn.pins) as [string, { controller: string; pin: number }][]) {
      const ctrl = controllers.find((c) => c.nodelabel === ref.controller);
      if (ctrl && ref.pin <= ctrl.maxPin - ctrl.minPin) {
        const placed = pushPin(placePin(conv, ref, controllers));
        if (placed) connectorExports.push({ label, pin: placed });
      }
    }
  }

  // LED / BUTTON from the record's DTS facts. A board fact is real even
  // when the pad is outside the sweep's family layout — construct it
  // directly so the export exists; the dtSpec path addresses it.
  const placeDts = (ref: { controller: string; pin: number }): GenPin | undefined =>
    pushPin(placePin(conv, ref, controllers));
  const ledPin = entry.led ? placeDts(entry.led) : undefined;
  // LED fallback when no gpio-leds node: the record's addressable-strip
  // fact (worldsemi,ws2812 — a plain-GPIO LED, no led0 spec).
  const ledPinFinal = ledPin
    ?? (entry.stripLed ? placeDts(entry.stripLed) : undefined);
  const buttonPin = entry.button ? placeDts(entry.button) : undefined;
  const extraLedPins = (entry.extraLeds ?? []).map((l) => placeDts(l)).filter((p): p is GenPin => p !== undefined);
  const extraButtonPins = (entry.extraButtons ?? []).map((b) => placeDts(b)).filter((p): p is GenPin => p !== undefined);

  // ── board.ts ────────────────────────────────────────────────────────────
  const hasUsb = entry.usbDevice === 'enabled';
  const wdtNodeLabel = entry.wdtNodeLabel;
  // Aliased pwm-leds (DT_ALIAS-addressable) — the board's own PWM LED
  // channels; specs ride virtual pins from 8192 (above every real range and
  // the opaque controller blocks).
  const pwmLedSpecs = (entry.pwmLeds ?? []).filter((l) => l.alias);
  const buses = entry.buses ?? { i2c: [], spi: [], uart: [] };
  // nRF PWM: any GPIO pad can carry any channel of a PWM peripheral (psel
  // routing — pinctrl psel order IS channel order), so it is a matrix like
  // the ESP32's LEDC: channels are assigned to the driven pads at overlay
  // time. The first declared peripheral (pwm0) is exposed: four concurrent
  // channels, and exceeding them is an explicit overlay error even though
  // further peripherals idle — a documented v1 ceiling.
  const pwmControllers = [...new Set(entry.pwmNodes ?? [])].sort();
  // pwm-leds specs (virtual pins 8192+) coexist with the matrix — a board's
  // own PWM LED channel plus any-pad matrix channels are different pins.
  const nrfPwmMatrix = entry.pwmMatrix || siliconPwm.length > 0 || !/^nrf/.test(soc) || pwmControllers.length === 0
    ? undefined
    : (() => {
        const gpio0 = controllers.find((c) => c.nodelabel === 'gpio0');
        const gpio1 = controllers.find((c) => c.nodelabel === 'gpio1');
        if (!gpio0) return undefined;
        const pads: number[] = [];
        for (let p = gpio0.minPin; p <= gpio0.maxPin; p++) pads.push(p);
        if (gpio1) for (let p = gpio1.minPin; p <= gpio1.maxPin; p++) pads.push(p);
        return { controller: pwmControllers[0]!, channelCount: 4, pads };
      })();
  const pwmMatrix = entry.pwmMatrix ?? nrfPwmMatrix;

  // Export-name reservation: the generated module must not redeclare. The
  // connector maps reuse labels across headers (the EK-RA8M1's two grove
  // headers both carry IO6/IO7/p7, wired to different pads), and a label
  // can also collide with a datasheet pin ident or a core export (LED,
  // I2C0, …). First connector label wins; later ones keep their
  // datasheet-named pin — always exported above — and the manifest's
  // pins.aliases follow the same rule so module and manifest agree.
  const reservedNames = new Set<string>([
    ...pins.map((p) => p.ident),
    'LED',
    'BUTTON',
    // '@typecad/hal/core' imports — a connector silkscreen label can literally be
    // 'Pin' (phyBOARD-Atlas), and `export const Pin` merges with the import.
    'Pin',
    'I2CBus',
    'SPIBus',
    'UART',
    'USBConsole',
    'PWM',
    // The ungated re-export block: a label colliding with any re-exported
    // hal name would be a duplicate module export.
    ...BOARD_UNGATED_EXPORTS,
  ]);
  buses.i2c.forEach((_, i) => reservedNames.add(`I2C${i}`));
  buses.spi.forEach((_, i) => reservedNames.add(`SPI${i}`));
  buses.uart.forEach((_, i) => reservedNames.add(`UART${i}`));
  if (hasUsb) reservedNames.add('USB0');
  pwmLedSpecs.forEach((_, i) => reservedNames.add(i === 0 ? 'PWMLED' : `PWMLED${i}`));
  const connectorLabelOwner = new Map<string, GenPin>();
  for (const { label, pin } of connectorExports) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(label)) continue;
    if (reservedNames.has(label) || connectorLabelOwner.has(label)) continue;
    connectorLabelOwner.set(label, pin);
  }

  const ts: string[] = [];
  ts.push(`// GENERATED by typecad-hal boardgen from the Zephyr board catalog —`);
  ts.push(`// ${entry.identifier} (${entry.name}, ${entry.vendor}).`);
  ts.push(`// Regenerate with: npx typecad-hal board regen`);
  ts.push('');
  // The generated module IS the user's '@typecad/hal' (the project tsconfig
  // maps that specifier here), so it reaches the implementation package via
  // the './core' subpath — the one specifier the paths mapping does not
  // capture, avoiding a circular self-reference.
  ts.push(`import { Pin, I2CBus, SPIBus, UART${hasUsb ? ', USBConsole' : ''}${pwmLedSpecs.length > 0 ? ', PWM' : ''} } from '@typecad/hal/core';`);
  ts.push('');
  // ── Hardware-class gateway ─────────────────────────────────────────────
  // This module is the NARROWED surface behind the user's '@typecad/hal'
  // import: every hardware class gated on board facts is re-exported below
  // only when this board's facts support it, so importing unavailable
  // hardware fails at module resolution (editor + transpile) instead of at
  // a deep diagnostic. Everything not gated (the lists hal ships in
  // gate.ts) is re-exported verbatim so the full authoring surface stays
  // importable from the same specifier ('@typecad/hal' is the one specifier —
  // the old '@typecad/board' alias was removed with the rename).
  ts.push('// Always-available HAL surface (not gated on board facts).');
  ts.push(`export { ${BOARD_UNGATED_EXPORTS.join(', ')} } from '@typecad/hal/core';`);
  ts.push(`export type { ${BOARD_UNGATED_TYPE_EXPORTS.join(', ')} } from '@typecad/hal/core';`);
  ts.push('');
  ts.push('// Hardware this board actually has — unavailable hardware is not importable.');
  if (wdtNodeLabel) ts.push(`export { Watchdog } from '@typecad/hal/core';`);
  if (siliconPwm.length > 0 || pwmLedSpecs.length > 0 || pwmMatrix) ts.push(`export { PWM } from '@typecad/hal/core';`);
  if (siliconAdc.length > 0) ts.push(`export { ADC } from '@typecad/hal/core';`);
  if (siliconDac.length > 0) ts.push(`export { DAC } from '@typecad/hal/core';`);
  if (buses.i2c.length > 0) ts.push(`export { I2CTarget } from '@typecad/hal/core';`);
  if (buses.spi.length > 0) ts.push(`export { SPITarget } from '@typecad/hal/core';`);
  if (buses.uart.length > 0) ts.push(`export { UART } from '@typecad/hal/core';`);
  if (hwtimerControllers.length > 0) ts.push(`export { Counter } from '@typecad/hal/core';`);
  if (hasUsb) ts.push(`export { USBConsole } from '@typecad/hal/core';`);
  // Store/File: a persisted backend needs a storage region — either the
  // board's own storage_partition (harvested reg) or a synthesizable one
  // (flash size known, no existing partition to collide with).
  if (entry.storageReg || (entry.flashKb && !entry.hasStoragePartition)) {
    ts.push(`export { Store, File } from '@typecad/hal/core';`);
  }
  ts.push('');
  if (pins.length > 0) {
    ts.push(`// Datasheet-named pins (derived from the board's devicetree controllers)`);
    for (const p of pins) {
      ts.push(`export const ${p.ident} = Pin.fromPort('${p.name}');`);
    }
    ts.push('');
  }
  for (const [label, pin] of connectorLabelOwner) {
    ts.push(`/** Connector pin ${label} → ${pin.name} */`);
    ts.push(`export const ${label} = ${pin.ident};`);
  }
  if (connectorLabelOwner.size > 0) ts.push('');
  // LED/BUTTON aliases reference pins the sweep may not carry (a pad
  // outside the derived controller table's family layout). Emit them
  // explicitly alongside the alias.
  const extraPinDecls: GenPin[] = [];
  if (ledPinFinal && !pins.some((p) => p.ident === ledPinFinal.ident)) extraPinDecls.push(ledPinFinal);
  if (buttonPin && !pins.some((p) => p.ident === buttonPin.ident) && buttonPin.ident !== ledPinFinal?.ident) extraPinDecls.push(buttonPin);
  for (const p of [...extraLedPins, ...extraButtonPins]) {
    if (!pins.some((x) => x.ident === p.ident) && !extraPinDecls.some((x) => x.ident === p.ident)) extraPinDecls.push(p);
  }
  for (const p of extraPinDecls) {
    ts.push(`/** ${p.name} (derived from the devicetree controller label). */`);
    ts.push(`export const ${p.ident} = Pin.fromPort('${p.name}');`);
  }
  if (ledPinFinal) {
    ts.push(`/** On-board LED (${entry.led ? `devicetree ${entry.led.dtSpec}` : 'addressable strip — no gpio-leds node'}). */`);
    ts.push(`export const LED = ${ledPinFinal.ident};`);
  }
  if (buttonPin) {
    ts.push(`/** User button (devicetree ${entry.button?.dtSpec}). */`);
    ts.push(`export const BUTTON = ${buttonPin.ident};`);
  }
  if (ledPinFinal || buttonPin || extraPinDecls.length > 0) ts.push('');

  // Bus instance exports from the board's own DTS-wired controllers.
  const busLines: string[] = [];
  buses.i2c.forEach((_, i) => busLines.push(`export const I2C${i} = new I2CBus('I2C${i}');`));
  buses.spi.forEach((_, i) => busLines.push(`export const SPI${i} = new SPIBus('SPI${i}');`));
  buses.uart.forEach((_, i) => busLines.push(`export const UART${i} = new UART('UART${i}');`));
  // USB CDC instance (the thin HAL's USBConsole): the board's DTS turns the
  // device controller on (zephyr_udc0 status okay).
  if (hasUsb) busLines.push(`export const USB0 = new USBConsole('USB0');`);

  // PWM-driven LEDs (pwm-leds): addressed by the board's own devicetree
  // alias (DT_ALIAS(pwm_led0) in the lowering) — no overlay needed. The
  // construction period comes from the DTS cell when it is a plain number
  // (macro periods like PWM_MSEC(20) are opaque to the reader — 1 ms, the
  // LED-dimming default, stands in).
  pwmLedSpecs.forEach((l, i) => {
    const period = l.periodNs ?? 1_000_000;
    const name = i === 0 ? 'PWMLED' : `PWMLED${i}`;
    busLines.push(`/** Board PWM LED (devicetree ${l.alias}${l.flags?.length ? ', ' + l.flags.join(' ') : ''}). */`);
    busLines.push(`export const ${name} = new PWM(${8192 + i}, { periodNs: ${period} });`);
  });
  if (busLines.length > 0) {
    ts.push('// Bus instance selectors (one per board-wired controller)');
    ts.push(...busLines);
    ts.push('');
  }

  // ── board.json (BoardConstants flat map + manifest) ─────────────────────
  const constants: Record<string, string | number | boolean> = {};
  constants['id'] = entry.identifier.split('/')[0];
  constants['name'] = entry.name;
  constants['architecture'] = soc;
  constants['build.frameworks.zephyr'] = entry.identifier;
  constants['zephyr.soc'] = soc;
  pins.forEach((p, i) => {
    constants[`pins.all.${i}.number`] = p.halPin;
    constants[`pins.all.${i}.gpio`] = p.halPin;
    constants[`pins.all.${i}.name`] = p.name;
    // digitalIn/out, interrupt, pull-up/down, open-drain are the Zephyr base
    // GPIO driver API (`gpio_pin_configure` flags + `gpio_pin_interrupt_configure`):
    // every GPIO controller implements them, so they are universally true —
    // a platform fact, not a per-pad one. Analog/PWM ride the harvested
    // silicon routes (honest per-pad facts).
    constants[`pins.all.${i}.capabilities.digitalInput`] = true;
    constants[`pins.all.${i}.capabilities.digitalOutput`] = true;
    constants[`pins.all.${i}.capabilities.analogInput`] = siliconAdcPins.has(p.halPin);
    constants[`pins.all.${i}.capabilities.analogOutput`] = siliconDacPins.has(p.halPin);
    constants[`pins.all.${i}.capabilities.pwm`] = siliconPwmPins.has(p.halPin);
    constants[`pins.all.${i}.capabilities.interrupt`] = true;
    constants[`pins.all.${i}.capabilities.pullUp`] = true;
    constants[`pins.all.${i}.capabilities.pullDown`] = true;
    // Capacitive touch has no harvested source yet (ESP32 touch pads live in
    // the pinctrl header matrix) — honestly false until a source lands.
    constants[`pins.all.${i}.capabilities.touch`] = false;
    constants[`pins.all.${i}.capabilities.openDrain`] = true;
  });
  constants['peripherals.i2c.count'] = buses.i2c.length;
  constants['peripherals.spi.count'] = buses.spi.length;
  constants['peripherals.uart.count'] = buses.uart.length;
  buses.i2c.forEach((_, i) => constants[`peripherals.i2c.${i}.instance`] = i);
  buses.spi.forEach((_, i) => constants[`peripherals.spi.${i}.instance`] = i);
  buses.uart.forEach((_, i) => constants[`peripherals.uart.${i}.instance`] = i);
  // Board pwm-led specs (virtual pins 8192+, dtSpec = the board's alias).
  // resolveChipFromBoard merges these into the active chip's pwm specs.
  pwmLedSpecs.forEach((l, i) => {
    constants[`zephyr.pwm.specs.${i}.pin`] = 8192 + i;
    constants[`zephyr.pwm.specs.${i}.dtSpec`] = l.alias!;
  });
  // Silicon PWM specs (real pads, pinctrl-routed) continue the index space
  // after the board-alias virtual-pin specs so the two never collide. The
  // overlay enables each referenced controller and derives the STM32 16-bit
  // prescaler from zephyr.pwm.clockHz.
  siliconPwm.forEach((s, i) => {
    const idx = pwmLedSpecs.length + i;
    constants[`zephyr.pwm.specs.${idx}.pin`] = s.pin;
    constants[`zephyr.pwm.specs.${idx}.controller`] = s.controller;
    constants[`zephyr.pwm.specs.${idx}.channel`] = s.channel;
    if (s.pinctrl) constants[`zephyr.pwm.specs.${idx}.pinctrl`] = s.pinctrl;
  });
  // Timer input clocks under the family's default clock tree (PWM_CLOCK_HZ
  // at module scope). Omitted when unknown — the overlay then leaves the
  // SoC-default prescaler in place.
  if (siliconPwm.length > 0) {
    const clock = Object.entries(PWM_CLOCK_HZ).find(([k]) => soc.startsWith(k))?.[1];
    if (clock) constants['zephyr.pwm.clockHz'] = clock;
  }
  // ADC facts: the first harvested controller's channels with the family
  // resolution/vref (STM32: 12-bit nominal VREF; ESP32 SARADC: 12-bit
  // against the ~1.1 V internal reference). The overlay enables the
  // controller and wires the used channels' pinctrl groups (STM32 only —
  // ESP32 pads are analog by silicon, no groups).
  if (siliconAdc.length > 0) {
    const isEsp = !!(entry.espAdc ?? []).length;
    constants['zephyr.adc.nodeLabel'] = isEsp ? (espAdcUnit ?? 'adc0') : adcSources[0];
    constants['zephyr.adc.resolution'] = 12;
    // vref: STM32 = VDDA nominal (3300); ESP32 SARADC = the ~1.1 V internal
    // reference; nRF SAADC = 3000 (the scheme the lowering's gain-1/4 +
    // internal-reference default assumes — matches the descriptor the XIAO's
    // hardware suite validated).
    constants['zephyr.adc.vrefMv'] = isEsp ? 1100 : nrfSaadcSynth ? 3000 : 3300;
    // The channel-setup gain/reference pair (ADC_CHANNEL_CFG at module
    // scope). Absent = the lowering's default (the nRF SAADC scheme:
    // ADC_GAIN_1_4 against ADC_REF_INTERNAL).
    const adcCfg = !isEsp
      ? Object.entries(ADC_CHANNEL_CFG).find(([k]) => soc.startsWith(k))?.[1]
      : undefined;
    if (adcCfg) {
      constants['zephyr.adc.gain'] = adcCfg.gain;
      constants['zephyr.adc.reference'] = adcCfg.reference;
    }
    siliconAdc.forEach((a, i) => {
      constants[`zephyr.adc.channels.${i}.pin`] = a.pin;
      constants[`zephyr.adc.channels.${i}.channel`] = a.channel;
      if (a.pinctrl) constants[`zephyr.adc.channels.${i}.pinctrl`] = a.pinctrl;
      if (a.controller) constants[`zephyr.adc.channels.${i}.controller`] = a.controller;
    });
  }
  // ESP32 LEDC matrix: any listed pad can carry any of channelCount
  // channels; the overlay assigns channels to the driven pads at build
  // time. Pins are global pad numbers (gpio0 base 0).
  if (pwmMatrix) {
    const ctrl = controllers.find((c) => c.nodelabel === 'gpio0');
    const base = ctrl ? ctrl.minPin : 0;
    constants['zephyr.pwm.matrix.controller'] = pwmMatrix.controller;
    constants['zephyr.pwm.matrix.channelCount'] = pwmMatrix.channelCount;
    pwmMatrix.pads.forEach((pad, i) => {
      constants[`zephyr.pwm.matrix.pins.${i}`] = base + pad;
    });
  }
  // DAC facts: the first harvested controller's output channels (STM32
  // 12-bit). The pinctrl source IS the DT nodelabel on STM32 (dac1), so it
  // maps straight to the device spec; the overlay enables the node and
  // wires the used channels' pinctrl groups.
  if (siliconDac.length > 0) {
    constants['zephyr.dac.device'] = dacSources[0];
    // ESP32's DAC is 8-bit; the STM32 DAC is 12-bit (the default).
    const dacResolution = esp32Dac ? 8 : 12;
    siliconDac.forEach((d, i) => {
      constants[`zephyr.dac.channels.${i}.pin`] = d.pin;
      constants[`zephyr.dac.channels.${i}.channel`] = d.channel;
      constants[`zephyr.dac.channels.${i}.resolution`] = dacResolution;
      constants[`zephyr.dac.channels.${i}.pinctrl`] = d.pinctrl;
    });
  }
  if (ledPinFinal) constants['pins.aliases.LED'] = ledPinFinal.name;
  if (buttonPin) constants['pins.aliases.BUTTON'] = buttonPin.name;

  // Extra LEDs / buttons beyond the canonical first — indexed aliases
  // INCLUDE the canonical first: LED0 = the first (same as LED), LED1 =
  // the second, etc. (the dtSpec numbering led0, led1, led2 lines up).
  if (ledPinFinal) constants['pins.aliases.LED0'] = ledPinFinal.name;
  if (buttonPin) constants['pins.aliases.BUTTON0'] = buttonPin.name;
  extraLedPins.forEach((p, i) => {
    constants[`pins.aliases.LED${i + 1}`] = p.name;
  });
  extraButtonPins.forEach((p, i) => {
    constants[`pins.aliases.BUTTON${i + 1}`] = p.name;
  });

  // Connector labels (D0–D20, A0–A10, SDA/SCL/MOSI/MISO/SCK/RX/TX/CS,
  // GP0–GP29, …) — every uncollided one becomes a pins.aliases.<label>
  // entry so `resolveHALReceiver` treats them as Pin constants (the same
  // path LED/BUTTON ride). The board.ts export already exists
  // (connectorLabelOwner); this makes the manifest agree.
  for (const [label, pin] of connectorLabelOwner) {
    constants[`pins.aliases.${label}`] = pin.name;
  }

  // Analog silkscreen offset: the lowest-numbered A-label's underlying HAL
  // pin. The hal-parser's A<N> fallback (no-manifest path) uses this to
  // map A0 → the board's actual analog base instead of assuming 14.
  const aLabels = connectorExports
    .filter(({ label }) => /^A\d+$/.test(label))
    .sort((a, b) => parseInt(a.label.slice(1), 10) - parseInt(b.label.slice(1), 10));
  if (aLabels.length > 0) {
    const a0 = aLabels[0];
    const idx = pins.indexOf(a0.pin);
    if (idx >= 0) {
      constants['pins.analogOffset'] = a0.pin.halPin;
    }
  }

  // ── GPIO controller routing ────────────────────────────────────────────
  // The strategy reconstructs its controller table from these constants via
  // resolveChipFromBoard — without them the GPIO lowering would default to
  // a `gpio0` nodelabel that doesn't exist on most vendors (undefined
  // `__device_dts_ord_…` at C++ compile time).
  controllers.forEach((c, i) => {
    constants[`zephyr.gpioControllers.${i}.nodelabel`] = c.nodelabel;
    constants[`zephyr.gpioControllers.${i}.minPin`] = c.minPin;
    constants[`zephyr.gpioControllers.${i}.maxPin`] = c.maxPin;
  });

  // Devicetree alias specs for the board's own LEDs/buttons: the lowering
  // prefers the dtSpec path (gpio_pin_set_dt), which honors the node's
  // polarity flags from the board DTS. They double as the canonical
  // interrupt sources (the board's buttons).
  const dtSpecEntries: { pin: number; dtSpec: string }[] = [];
  if (entry.led && ledPin) dtSpecEntries.push({ pin: ledPin.halPin, dtSpec: entry.led.dtSpec });
  if (entry.button && buttonPin) dtSpecEntries.push({ pin: buttonPin.halPin, dtSpec: entry.button.dtSpec });
  (entry.extraLeds ?? []).forEach((l, i) => {
    const p = extraLedPins[i];
    if (p) dtSpecEntries.push({ pin: p.halPin, dtSpec: l.dtSpec });
  });
  (entry.extraButtons ?? []).forEach((b, i) => {
    const p = extraButtonPins[i];
    if (p) dtSpecEntries.push({ pin: p.halPin, dtSpec: b.dtSpec });
  });
  dtSpecEntries.forEach((s, i) => {
    constants[`zephyr.gpio.dtSpecs.${i}.pin`] = s.pin;
    constants[`zephyr.gpio.dtSpecs.${i}.dtSpec`] = s.dtSpec;
    constants[`zephyr.gpio.interruptPins.${i}.pin`] = s.pin;
    constants[`zephyr.gpio.interruptPins.${i}.dtSpec`] = s.dtSpec;
  });

  // Bus controllers the board's own DTS wires up — resolveChipFromBoard
  // reconstructs the bus lists from these, and the overlays enable the
  // nodes the program uses.
  buses.i2c.forEach((nodelabel, i) => {
    constants[`zephyr.i2c.controllers.${i}.nodeLabel`] = nodelabel;
  });
  buses.spi.forEach((nodelabel, i) => {
    constants[`zephyr.spi.controllers.${i}.nodeLabel`] = nodelabel;
  });
  buses.uart.forEach((nodelabel, i) => {
    constants[`zephyr.uart.controllers.${i}.nodeLabel`] = nodelabel;
  });

  // USB device (CDC-ACM): the board's DTS turned the controller on.
  if (hasUsb) {
    constants['zephyr.usb.controller'] = entry.usbController ?? 'zephyr_udc0';
    constants['zephyr.usb.cdcInstances'] = 1;
  }

  // Watchdog: the board's devicetree watchdog0 alias.
  if (entry.wdtNodeLabel) {
    constants['zephyr.wdt.nodeLabel'] = entry.wdtNodeLabel;
  }

  // Storage partition facts (Store/FS). Boards whose DTS ships a
  // storage_partition (ESP32's AMP layout) carry its REAL reg — the overlay
  // then writes only the /chosen pointer, never a redeclaration. Boards
  // without one get a region synthesized near the TOP of flash (the app
  // image grows from the bottom, so the end is the conventional safe
  // region). Region = 1/8 of flash, clamped to [16KB, 128KB], 4KB-aligned.
  if (entry.storageReg) {
    constants['zephyr.storage.offset'] = entry.storageReg.offsetBytes;
    constants['zephyr.storage.size'] = entry.storageReg.sizeBytes;
    constants['zephyr.storage.preexisting'] = true;
  } else if (entry.flashKb && !entry.hasStoragePartition) {
    const regionKb = Math.min(128, Math.max(16, Math.floor(entry.flashKb / 8 / 4) * 4));
    constants['zephyr.storage.offset'] = (entry.flashKb - regionKb) * 1024;
    constants['zephyr.storage.size'] = regionKb * 1024;
  }

  // Hardware counters: the free-counter list was computed above (with the
  // kernel-claim exclusions); emit the controller facts. The child form
  // (ESP32 timers) carries the parent the overlay attaches the label to.
  hwtimerControllers.forEach((c, i) => {
    constants[`zephyr.hwtimer.controllers.${i}.nodeLabel`] = c.nodeLabel ?? `tc_counter${i}`;
    if (c.parentLabel) constants[`zephyr.hwtimer.controllers.${i}.counterParent`] = c.parentLabel;
  });

  // Probe methods — the debug-config writer and `west flash` runner choice
  // read them from the board constants as zephyr.probeMethods.N.*. The
  // table is the board's own board.cmake runners, so `zephyr.probe`
  // resolves on every board that declares runners.
  (entry.probeMethods ?? []).forEach((pm, i) => {
    constants[`zephyr.probeMethods.${i}.id`] = pm.id;
    constants[`zephyr.probeMethods.${i}.runner`] = pm.runner;
    if (pm.args) constants[`zephyr.probeMethods.${i}.args`] = pm.args.join(',');
    if (pm.description) constants[`zephyr.probeMethods.${i}.description`] = pm.description;
    if (pm.debug !== undefined) constants[`zephyr.probeMethods.${i}.debug`] = pm.debug;
    if (pm.debugInterface) constants[`zephyr.probeMethods.${i}.debugInterface`] = pm.debugInterface;
    if (pm.debugDevice) constants[`zephyr.probeMethods.${i}.debugDevice`] = pm.debugDevice;
    // cfg lines join on newlines — they legally contain commas (tcl event
    // blocks), which the comma convention would corrupt.
    if (pm.debugCfg) constants[`zephyr.probeMethods.${i}.debugCfg`] = pm.debugCfg.join('\n');
    const src = (pm as ZephyrProbeMethod).debugCfgSource;
    if (src) constants[`zephyr.probeMethods.${i}.debugCfgSource`] = src.join('\n');
  });

  const manifest = {
    version: 1,
    identifier: entry.identifier,
    soc,
    pinNames: pins.map((p) => p.name),
    constants,
    // Source fingerprint: covers the record content, the extraction
    // revision, and the tree provenance (when the record came from a
    // catalog). `typecad-hal build` recomputes it cheaply and regenerates
    // this module when it moves — a board change in the config, the catalog
    // overlay, or the Zephyr tree itself recreates the module.
    source: {
      generatorRev: GENERATOR_REV,
      fingerprint: boardRecordFingerprint(entry, loadBoardCatalogOverlay()) + factsSuffix,
    },
  };

  return {
    boardTs: ts.join('\n'),
    boardJson: JSON.stringify(manifest, null, 1),
    board: entry,
    ...(userWarnings.length > 0 ? { warnings: userWarnings } : {}),
  };
}

/**
 * Generate the board module contents for a qualified Zephyr board target
 * ('esp32s3_devkitc/esp32s3/procpu'). Bare SoC names are not targets —
 * every board resolves through the catalog like any other.
 */
export function generateBoard(
  target: string,
  opts?: { factsJson?: string; asBuiltJson?: string },
): GeneratedBoard {
  const found = findBoardData(target);
  if (!found) {
    const hint = loadBoardCatalogOverlay()
      ? `'${target}' is not a board target in the current catalog. ` +
        `It may be new in your Zephyr tree — run 'typecad-hal board sync' and retry.`
      : `No board catalog on this machine. Run 'typecad-hal board sync' first.`;
    throw new Error(hint);
  }
  // The as-built snapshot (this project's last successful build's resolved
  // zephyr.dts): the stable name-grammar routes shadow the walker's harvest
  // per pin — a broken catalog regex cannot reach the user's board module.
  // Ignored when absent, unparseable, or written for a different board.
  let entry = found;
  const asBuiltWarnings: string[] = [];
  let asBuiltApplied = false;
  if (opts?.asBuiltJson !== undefined) {
    try {
      const asBuilt = parseAsBuiltJson(opts.asBuiltJson);
      if (asBuilt.board.toLowerCase() === found.identifier.toLowerCase()) {
        entry = mergeAsBuilt(found, asBuilt, asBuiltWarnings);
        asBuiltApplied = true;
      }
    } catch (err) {
      asBuiltWarnings.push(`ignoring as-built snapshot: ${(err as Error).message}`);
    }
  }
  // The project's typecad-hal.facts.json, when present: the section for THIS
  // board merges into the manifest (user routes win per pin), and the raw
  // text hashes into the module's source fingerprint so edits regenerate.
  let facts: UserBoardFacts | undefined;
  let suffix = '';
  if (opts?.factsJson !== undefined) {
    facts = userFactsForTarget(parseUserFactsJson(opts.factsJson), entry.identifier) ?? undefined;
    suffix = factsFingerprint(opts.factsJson);
  }
  // The hash only joins the fingerprint when the snapshot actually applied
  // (a foreign-board snapshot is ignored and must not force regeneration).
  if (asBuiltApplied && opts?.asBuiltJson !== undefined) suffix += factsFingerprint(opts.asBuiltJson);
  return buildModule(entry, facts, suffix, asBuiltWarnings);
}

/**
 * Merge as-built routes over the walker's harvested routes per PAD
 * (port+bit). Identical routes pass silently; a disagreement warns and the
 * as-built route wins — the resolved devicetree is ground truth for
 * DT-expressible facts. Analog-device cross-checks are not re-applied: the
 * build already proved the device exists.
 */
function mergeAsBuilt(
  entry: BoardDataEntry,
  asBuilt: AsBuiltFile,
  warnings: string[],
): BoardDataEntry {
  const merge = <T extends { source: string; channel: number; port: string; bit: number; pinctrl?: string }>(
    harvested: readonly T[] | undefined,
    asBuiltRoutes: readonly AsBuiltRoute[],
    kind: string,
  ): T[] => {
    const out: T[] = [];
    const asByPad = new Map(asBuiltRoutes.map((r) => [`${r.port}${r.bit}`, r]));
    for (const h of harvested ?? []) {
      const a = asByPad.get(`${h.port}${h.bit}`);
      if (!a) {
        out.push(h);
        continue;
      }
      asByPad.delete(`${h.port}${h.bit}`);
      if (a.source !== h.source || a.channel !== h.channel) {
        warnings.push(
          `as-built ${kind} on ${h.port}${h.bit}: build says ${a.source} ch ${a.channel}, ` +
          `harvest said ${h.source} ch ${h.channel} — the build wins.`,
        );
      }
      out.push({ ...(h as object), source: a.source, channel: a.channel, pinctrl: a.pinctrl } as T);
    }
    // As-built pads the harvest never found (a broken regex's blind spot).
    for (const a of asByPad.values()) {
      out.push({ source: a.source, channel: a.channel, port: a.port, bit: a.bit, pinctrl: a.pinctrl } as T);
    }
    return out;
  };
  return {
    ...entry,
    adcPins: merge(entry.adcPins, asBuilt.routes.adcPins, 'adc route'),
    pwmPins: merge(entry.pwmPins, asBuilt.routes.pwmPins, 'pwm route'),
    dacPins: merge(entry.dacPins, asBuilt.routes.dacPins, 'dac route'),
  };
}

/**
 * Generate the board module for a CONTRACT board — a custom PCB with no
 * Zephyr board record. The contract (exported from a TypeCAD project)
 * supplies the wired pads by datasheet name and which bus families the PCB
 * routes; the SoC's bus controller nodelabels come from the INSTALLED
 * Zephyr tree's soc dtsi (the SDK is the source of truth — a contract build
 * compiles against that tree).
 *
 * Returns a full board module (the transpiler's pin map + chip resolution
 * read board.json). The caller layers the narrowed board.ts on top, so the
 * firmware can only touch pads the PCB actually wired.
 */
export function generateBoardModuleFromContract(opts: {
  soc: string;
  zephyrBase: string;
  /** Wired pad names in the soc's datasheet form (PA5, P0.28, GP25...). */
  pinNames: readonly string[];
  /** Functional names to export as aliases of a wired pad (TX → PA9). */
  padAliases?: readonly { exportName: string; padName: string }[];
  /** Which bus families the PCB routes. */
  peripherals: { i2c: boolean; spi: boolean; uart: boolean };
}): { boardTs: string; boardJson: string } {
  const pads: { name: string; controller: string; pin: number }[] = [];
  for (const name of opts.pinNames) {
    const parsed = parsePinName(opts.soc, name);
    if (!parsed) {
      console.error(`contract: pad '${name}' does not match ${opts.soc} naming conventions — skipped`);
      continue;
    }
    pads.push({ name, controller: parsed.controller, pin: parsed.pin });
  }
  if (pads.length === 0) {
    throw new Error(
      `None of the contract's pads (${opts.pinNames.join(', ')}) match ${opts.soc} naming ` +
      `conventions — name them by their datasheet form (PA5, P0.28, GP25, GPIO9).`,
    );
  }

  // SoC bus labels from the installed tree, gated to the wired families.
  const treeBuses = socBusLabelsFromTree(opts.zephyrBase, opts.soc);
  const buses = {
    i2c: opts.peripherals.i2c ? treeBuses.i2c : [],
    spi: opts.peripherals.spi ? treeBuses.spi : [],
    uart: opts.peripherals.uart ? treeBuses.uart : [],
  };

  // Synthetic catalog record shaped like a walker record, routed through the
  // SAME module builder as every board: the wired pads ride in as a
  // 'contract' connector (labels = datasheet names), and deriveControllers
  // builds the controller table from them like it does for any board.
      // Functional aliases (TX = PA9) ride the contract connector under a
    // second label — buildModule's connectorLabelOwner exports them as
    // TX = PA9 and stamps pins.aliases.TX.
    const padEntries: [string, { controller: string; pin: number; flags: string[] }][] = pads.map(
      (p) => [p.name, { controller: p.controller, pin: p.pin, flags: [] }],
    );
    for (const a of opts.padAliases ?? []) {
      const pad = pads.find((p) => p.name === a.padName);
      if (pad) padEntries.push([a.exportName, { controller: pad.controller, pin: pad.pin, flags: [] }]);
    }

    const entry: BoardDataEntry = {
      identifier: `contract/${opts.soc}`,
      name: `${opts.soc} custom board (contract)`,
      vendor: 'typecad',
      dts: '',
      buses: Object.values(buses).some((b) => b.length > 0) ? buses : undefined,
      connectors: padEntries.length > 0
        ? [{
            nodelabel: 'contract',
            compatible: 'typecad,contract',
            pins: Object.fromEntries(padEntries),
          }]
        : undefined,
    };
    return buildModule(entry);
}
