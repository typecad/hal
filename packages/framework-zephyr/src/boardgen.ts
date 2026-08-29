// ---------------------------------------------------------------------------
// boardgen.ts — project-local board module generator (Phase 2).
//
// Joins a board variant from the generated data pack (board-data.generated,
// extracted from the Zephyr tree) with its SoC's curated chip descriptor
// (chips/soc) and emits the two artifacts a project carries instead of a
// board package:
//
//   .cuttlefish/board.ts   — typed pin/bus/LED/BUTTON exports (the virtual
//                            @typecad/board module points here)
//   .cuttlefish/board.json — the BoardConstants flat map (pins.all.*,
//                            peripherals.*, zephyr.*) + pinNames (the
//                            contract-flow manifest data)
//
// Pure: returns the file contents; the caller (cuttlefish config-loader via
// the strategy hook, or `cuttlefish board regen`) writes them.
//
// Tiering: a validated/derived soc descriptor yields full pin facts; an
// unknown soc yields the board's connector/alias pins + LED/BUTTON only,
// with an honest note naming the soc.
// ----------------------------------------------------------------------------

import type { BoardDataEntry } from './sdk/board-data.generated.js';
import { BOARD_DATA } from './sdk/board-data.generated.js';
import type { ZephyrChipDescriptor, ZephyrGpioController, ZephyrProbeMethod } from './chips/types.js';
import { chipForSoc } from './chips/index.js';
import { BOARD_OVERRIDES } from './chips/board-overrides.js';

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
  /** The resolved soc descriptor when one exists (tier info for notes). */
  readonly chip: ZephyrChipDescriptor | undefined;
}

/** Look up a board variant by qualified target or bare board id. */
export function findBoardData(target: string): BoardDataEntry | undefined {
  const raw = target.trim();
  // Exact case first — revision qualifiers are case-sensitive
  // (mimxrt1060_evk@A).
  if (BOARD_DATA[raw]) return BOARD_DATA[raw];
  const t = raw.toLowerCase();
  if (BOARD_DATA[t]) return BOARD_DATA[t];
  // Bare board id or board/soc without the qualifier: first matching key.
  const exact = Object.keys(BOARD_DATA).find((k) => k === t);
  if (exact) return BOARD_DATA[exact];
  const prefix = Object.keys(BOARD_DATA).find((k) => k.toLowerCase().startsWith(t + '/'));
  return prefix ? BOARD_DATA[prefix] : undefined;
}

/** soc name from a qualified target ('board/soc/qual' → 'soc'). */
export function socOfTarget(target: string): string {
  const parts = target.split('/');
  return parts.length >= 2 ? parts[1] : '';
}

function identOf(name: string): string {
  return name.replace(/\./g, '_');
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
 * port convention. Widths are pinned empirically against the board data
 * pack (max observed bit per family): Renesas RA `ioport<N>` ports are 16
 * bits with letters continuing past ioport9 (a = port 10); Atmel
 * `port<letter>`/`pio<letter>` are 32-bit ports; Cypress `gpio_prt<N>` are
 * 8-bit ports; Ambiq Apollo splits banks into range-encoded `gpio<lo>_<hi>`
 * nodes; `gpio<letter>` is STM32-style 16-pin ports; bare `gpio<digit>` is
 * the nRF/ESP-style 32-pin controller. Returns undefined when the name
 * encodes no derivable range.
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
  m = name.match(/^gpio([a-p])$/); // STM32 16-pin ports
  if (m) {
    const base = letterIndex(m[1]) * 16;
    return { nodelabel: name, minPin: base, maxPin: base + 15 };
  }
  if (name === 'gpio') {
    // Flat single-controller boards (musca, neorv32).
    return { nodelabel: name, minPin: 0, maxPin: 31 };
  }
  return undefined;
}

/**
 * Tier-3 controller table: derive from the controller names present in the
 * pack's DTS facts. Names that encode no derivable range but are real
 * controllers (the MPS2 boards' dedicated gpio_led0/gpio_button FPGAIO IPs,
 * the Pi 5's gio_aon bank) get opaque high bases — collision-free by
 * construction, and LED/BUTTON ride the devicetree alias path anyway.
 * Expanders are excluded (isExpanderController).
 */
function deriveTier3Controllers(entry: BoardDataEntry): ZephyrGpioController[] {
  const names = new Set<string>();
  if (entry.led) names.add(entry.led.controller);
  if (entry.button) names.add(entry.button.controller);
  for (const c of entry.extraLeds ?? []) names.add(c.controller);
  for (const c of entry.extraButtons ?? []) names.add(c.controller);
  for (const conn of entry.connectors ?? []) {
    for (const ref of Object.values(conn.pins)) names.add(ref.controller);
  }
  const derived: ZephyrGpioController[] = [];
  const opaque: string[] = [];
  for (const name of names) {
    if (isExpanderController(name)) continue;
    const range = controllerRangeFor(name);
    if (range) derived.push(range);
    else opaque.push(name);
  }
  // Opaque controllers: deterministic sequential slots far above any
  // derived range so HAL pin numbers never collide.
  opaque.sort().forEach((name, i) => {
    derived.push({ nodelabel: name, minPin: 4096 + i * 32, maxPin: 4096 + i * 32 + 31 });
  });
  derived.sort((a, b) => a.minPin - b.minPin);
  return derived;
}

/**
 * Tier-3 pin placement: name + HAL number for a (controller, bit) fact,
 * consistent with deriveTier3Controllers' numbering. Family-aware naming
 * (ioport1.3 → P103, gpio0_31.5 → GPIO5, porta.23 → PA23, gpio_prt5.6 →
 * P5_6, gpioc.13 → PC13, gpio0.26 → GPIO26). Undefined when the controller
 * is an expander or encodes no range and has no opaque slot.
 */
function tier3Place(
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
  // the HAL number is the global pin (base + bit), matching the family's
  // gpio<N> schematic naming.
  if (/gpio\d/.test(ref.controller)) return placed(`GPIO${ctrl.minPin + ref.pin}`);
  // Opaque controllers (gpio_led0, gio_aon, …): generic label-based name.
  const letters = ref.controller.replace(/[^a-z]/gi, '').toUpperCase().replace('GPIO', '');
  const name = letters.length > 0 ? `P${letters}${ref.pin}` : `${ref.controller.toUpperCase()}${ref.pin}`;
  return placed(name);
}

/** Datasheet pin names for one controller range, per the soc's convention. */
function controllerPinNames(
  conv: ZephyrChipDescriptor['pinNaming'],
  ctrl: ZephyrGpioController,
): { name: string; ctrlPin: number }[] {
  const out: { name: string; ctrlPin: number }[] = [];
  // Port-bit count: 16 for port-based SoCs (stm32/samd), the controller's
  // range span otherwise.
  const isPort = conv === 'stm32-port' || conv === 'samd-port';
  const span = ctrl.maxPin - ctrl.minPin + 1;
  const count = isPort ? Math.min(span, 16) : span;
  for (let bit = 0; bit < count; bit++) {
    let name: string;
    switch (conv) {
      case 'esp32-gpio':
        name = `GPIO${ctrl.minPin + bit}`;
        break;
      case 'rp-gpio':
        name = `GP${ctrl.minPin + bit}`;
        break;
      case 'nrf-port':
        name = `P${ctrl.nodelabel.replace(/[^0-9]/g, '') || 0}.${String(bit).padStart(2, '0')}`;
        break;
      case 'stm32-port':
      case 'samd-port':
      default:
        // 'gpioa' → A, 'porta' → A (Atmel labels carry no GPIO prefix).
        name = `P${ctrl.nodelabel.replace(/[^a-z]/gi, '').toUpperCase().replace('GPIO', '').replace(/^PORT/, '')}${bit}`;
        break;
    }
    out.push({ name, ctrlPin: bit });
  }
  return out;
}

/**
 * Generate the board module contents for a qualified Zephyr board target
 * ('esp32s3_devkitc/esp32s3/procpu') or a bare SoC name ('stm32f411xe' —
 * contract projects with a custom PCB and no board target; emits the soc's
 * full pin set with no board-level facts). Throws when neither resolves.
 */
export function generateBoard(target: string): GeneratedBoard {
  const board = findBoardData(target);
  const socChip = chipForSoc(target);
  if (!board && !socChip) {
    throw new Error(
      `'${target}' is neither a board target in the Zephyr board data pack nor a ` +
      `known SoC name. Use a qualified target (e.g. 'esp32s3_devkitc/esp32s3/procpu') ` +
      `or a soc name (e.g. 'stm32f411xe').`,
    );
  }
  // Soc mode (no board): a synthetic entry carrying the soc's pins only.
  const entry: BoardDataEntry = board ?? {
    identifier: socChip!.id.includes('/') ? socChip!.id : `${socChip!.id}/${socChip!.soc}`,
    name: socChip!.soc,
    vendor: '(soc)',
    dts: '',
  };
  const soc = socOfTarget(entry.identifier);
  const chip = chipForSoc(entry.identifier);
  const tier = chip?.tier ?? 'derived';

  // ── Pin set ─────────────────────────────────────────────────────────────
  const pins: GenPin[] = [];
  const excluded = new Set(chip?.excludedPins ?? []);
  const controllers = chip?.gpioControllers ?? (chip ? [{ nodelabel: chip.gpioController, minPin: 0, maxPin: 63 }] : []);
  const adcPins = new Set((chip?.adc?.channels ?? []).map((c) => c.pin));
  const pwmPins = new Set([
    ...(chip?.pwm?.specs ?? []).map((s) => s.pin),
    ...(chip?.pwm?.matrix?.pins ?? []),
  ]);
  const dacPins = new Set((chip?.dac?.channels ?? []).map((c) => c.pin));

  if (chip?.pinNaming && controllers.length > 0) {
    for (const ctrl of controllers) {
      for (const { name, ctrlPin } of controllerPinNames(chip.pinNaming, ctrl)) {
        const halPin = ctrl.minPin + ctrlPin;
        if (excluded.has(halPin)) continue;
        pins.push({ name, ident: identOf(name), halPin });
      }
    }
  }

  // Tier-3 GPIO controller table (the soc has no curated descriptor): derive
  // from the DTS controller names in the pack's facts per the vendor-family
  // conventions (deriveTier3Controllers). Shared by the connector loop,
  // placeDts, and the zephyr.gpioControllers constants below — keeps the HAL
  // pin numbering consistent across all three.
  const tier3Table = controllers.length === 0 ? deriveTier3Controllers(entry) : undefined;

  // Connector pins from the pack (labels like D0/D10) — always available,
  // even on tier-3 socs. Map (controller, pin) → HAL number via the
  // controllers table when possible; skip pins we cannot place.
  const connectorExports: { label: string; pin: GenPin }[] = [];
  for (const conn of entry.connectors ?? []) {
    for (const [label, ref] of Object.entries(conn.pins) as [string, { controller: string; pin: number }][]) {
      const ctrl = controllers.find((c) => c.nodelabel === ref.controller);
      if (ctrl) {
        const halPin = ctrl.minPin + ref.pin;
        const existing = pins.find((p) => p.halPin === halPin);
        // A minted pin (the pad is outside the general sweep — excluded or
        // unwired silicon) needs an ident distinct from the label export
        // (the connector section also emits `export const <label> = …`).
        const pin: GenPin = existing
          ?? { name: `${label}(${ref.controller}.${ref.pin})`, ident: `${label}_${ref.controller}_${ref.pin}`, halPin };
        if (!existing && !excluded.has(halPin)) pins.push(pin);
        connectorExports.push({ label, pin });
      } else if (tier3Table) {
        // Tier-3: place via the derived controller table (family-aware
        // name + range-consistent HAL number). Expanders and
        // non-derivable controllers place no pin.
        const placed = tier3Place(ref, tier3Table);
        if (placed) {
          if (!pins.some((p) => p.ident === placed.ident)) pins.push(placed);
          connectorExports.push({ label, pin: placed });
        }
      }
      // Controller exists but doesn't match (nexus phandle on a curated
      // soc): skip — we can't place it without the nexus map.
    }
  }

  // LED / BUTTON from the pack's DTS facts, placed on the HAL pin map.
  // A board fact is real even when the pad is excluded from the general-
  // purpose sweep (the S3's BUTTON sits on the GPIO0 strap pin): construct
  // the pin directly so the export exists; the dtSpec path addresses it.
  // Tier-3 fallback: place via the derived controller table (tier3Place,
  // defined at module scope) — family-aware name, HAL number consistent
  // with the derived zephyr.gpioControllers constants below.
  const placeDts = (ref: { controller: string; pin: number }): GenPin | undefined => {
    const ctrl = controllers.find((c) => c.nodelabel === ref.controller);
    if (!ctrl) {
      if (tier3Table) {
        // Tier-3: derive from the DTS controller name.
        return tier3Place(ref, tier3Table);
      }
      return undefined;
    }
    const halPin = ctrl.minPin + ref.pin;
    return (
      pins.find((p) => p.halPin === halPin) ??
      (() => {
        const name = chip?.pinNaming === 'esp32-gpio' ? `GPIO${halPin}`
          : chip?.pinNaming === 'rp-gpio' ? `GP${halPin}`
          : chip?.pinNaming === 'nrf-port'
            ? `P${(ctrl.nodelabel.replace(/[^0-9]/g, '') || '0')}.${String(ref.pin).padStart(2, '0')}`
            : `P${ctrl.nodelabel.replace(/[^a-z]/gi, '').toUpperCase().replace('GPIO', '').replace(/^PORT/, '')}${ref.pin}`;
        return { name, ident: identOf(name), halPin };
      })()
    );
  };
  const ledPin0 = entry.led ? placeDts(entry.led) : undefined;
  // LED fallbacks for boards with no gpio-leds node: first the pack's
  // addressable-strip fact (worldsemi,ws2812 — a plain-GPIO LED, no led0
  // spec), then the curated board override (chips/board-overrides — the S3
  // devkit's WS2812, which its DTS doesn't declare at all).
  const override = BOARD_OVERRIDES[entry.identifier.split('/')[0]];
  let ledPin = ledPin0
    ?? (entry.stripLed ? placeDts(entry.stripLed) : undefined)
    ?? (override?.led ? pins.find((p) => p.name === override.led) : undefined);
  const buttonPin = entry.button ? placeDts(entry.button) : undefined;
  // Tier-3 LED/BUTTON pins ride the manifest too (pin map + aliases) even
  // though the general-purpose sweep has no controller table to fill. On
  // curated socs (controller table present) they must NOT join the sweep —
  // the strap-pin exclusions apply (the S3's BUTTON sits on excluded GPIO0)
  // and the export uses the constructor fallback instead.
  if (tier3Table) {
    if (ledPin && !pins.some((p) => p.ident === ledPin.ident)) pins.push(ledPin);
    if (buttonPin && !pins.some((p) => p.ident === buttonPin.ident)) pins.push(buttonPin);
  }

  // Derived A-labels for connector-less boards: when the board's DTS
  // declares no connector map but the curated soc knows the ADC channels,
  // A<N> = the pin of ADC channel N (the stm32duino analogInputPin
  // convention). Only when the channels are numbered contiguously from 0 —
  // a scattered channel map (SAMD's high channel numbers) does not carry a
  // board A-ordering, and boards with connector A-labels keep theirs.
  if (!connectorExports.some(({ label }) => /^A\d+$/.test(label)) && (chip?.adc?.channels?.length ?? 0) > 0) {
    const chans = [...chip!.adc!.channels!].sort((a, b) => a.channel - b.channel);
    if (chans.every((c, i) => c.channel === i)) {
      for (const c of chans) {
        const p = pins.find((x) => x.halPin === c.pin);
        if (p) connectorExports.push({ label: `A${c.channel}`, pin: p });
      }
    }
  }

  // ── board.ts ────────────────────────────────────────────────────────────
  const hasUsb = (chip?.usb?.cdcInstances ?? 0) > 0 && entry.usbDevice !== 'disabled';
  // Aliased pwm-leds (DT_ALIAS-addressable) — the board's own PWM LED
  // channels; specs ride virtual pins from 8192 (above every real range and
  // the tier-3 opaque controller blocks).
  const pwmLedSpecs = (entry.pwmLeds ?? []).filter((l) => l.alias);
  const ts: string[] = [];
  ts.push(`// GENERATED by cuttlefish boardgen from the Zephyr board data pack —`);
  ts.push(`// ${entry.identifier} (${entry.name}, ${entry.vendor}).`);
  ts.push(`// Soc: ${soc}${chip ? ` (tier: ${tier})` : ' (no curated descriptor — connector/alias pins only)'}.`);
  ts.push(`// Regenerate with: npx cuttlefish board regen`);
  ts.push('');
  ts.push(`import { Pin, I2CBus, SPIBus, SerialPort${hasUsb ? ', USBConsole' : ''}${pwmLedSpecs.length > 0 ? ', PWM' : ''} } from '@typecad/hal';`);
  ts.push('');
  if (pins.length > 0) {
    ts.push(`// Datasheet-named pins (${chip?.pinNaming ?? 'connector'} convention)`);
    for (const p of pins) {
      ts.push(`export const ${p.ident} = Pin.fromPort('${p.name}');`);
    }
    ts.push('');
  }
  for (const { label, pin } of connectorExports) {
    if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(label)) {
      ts.push(`/** Connector pin ${label} → ${pin.name} */`);
      ts.push(`export const ${label} = ${pin.ident};`);
    }
  }
  if (connectorExports.length > 0) ts.push('');
  // Tier-3 LED/BUTTON: the pin sweep is empty (no controller table), so the
  // LED/BUTTON aliases reference pins with no `Pin.fromPort` declaration.
  // Emit them explicitly alongside the alias.
  const extraPinDecls: GenPin[] = [];
  if (ledPin && !pins.some((p) => p.ident === ledPin.ident)) extraPinDecls.push(ledPin);
  if (buttonPin && !pins.some((p) => p.ident === buttonPin.ident) && buttonPin.ident !== ledPin?.ident) extraPinDecls.push(buttonPin);
  for (const p of extraPinDecls) {
    ts.push(`/** ${p.name} (derived from the devicetree controller label). */`);
    ts.push(`export const ${p.ident} = Pin.fromPort('${p.name}');`);
  }
  if (ledPin) {
    ts.push(`/** On-board LED (${entry.led ? `devicetree ${entry.led.dtSpec}` : 'curated board fact — no gpio-leds node'}). */`);
    ts.push(`export const LED = ${ledPin.ident};`);
  }
  if (buttonPin) {
    ts.push(`/** User button (devicetree ${entry.button?.dtSpec}). */`);
    ts.push(`export const BUTTON = ${buttonPin.ident};`);
  }
  if (ledPin || buttonPin || extraPinDecls.length > 0) ts.push('');

  // Bus instance exports from the soc descriptor's wired controllers.
  const busLines: string[] = [];
  const i2cCount = chip?.i2c?.controllers.length ?? 0;
  const spiCount = chip?.spi?.controllers.length ?? 0;
  const uartCount = chip?.uart?.controllers.length ?? 0;
  for (let i = 0; i < i2cCount; i++) busLines.push(`export const I2C${i} = new I2CBus('I2C${i}');`);
  for (let i = 0; i < spiCount; i++) busLines.push(`export const SPI${i} = new SPIBus('SPI${i}');`);
  for (let i = 0; i < uartCount; i++) busLines.push(`export const UART${i} = new SerialPort('UART${i}');`);
  // USB CDC instance (the thin HAL's USBConsole): the D+/D- pair is fixed
  // silicon wiring, not a per-board choice — one instance per soc with a
  // USB device controller. A board DTS that explicitly disables the device
  // controller vetoes the export.
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
    ts.push('// Bus instance selectors (one per wired controller)');
    ts.push(...busLines);
    ts.push('');
  }

  // ── board.json (BoardConstants flat map + manifest) ─────────────────────
  const constants: Record<string, string | number | boolean> = {};
  constants['id'] = entry.identifier.split('/')[0];
  constants['name'] = entry.name;
  constants['architecture'] = chip?.soc ?? soc;
  constants['build.frameworks.zephyr'] = entry.identifier;
  constants['zephyr.soc'] = soc;
  pins.forEach((p, i) => {
    constants[`pins.all.${i}.number`] = p.halPin;
    constants[`pins.all.${i}.gpio`] = p.halPin;
    constants[`pins.all.${i}.name`] = p.name;
    constants[`pins.all.${i}.capabilities.digitalInput`] = true;
    constants[`pins.all.${i}.capabilities.digitalOutput`] = true;
    constants[`pins.all.${i}.capabilities.analogInput`] = adcPins.has(p.halPin);
    constants[`pins.all.${i}.capabilities.analogOutput`] = dacPins.has(p.halPin);
    constants[`pins.all.${i}.capabilities.pwm`] = pwmPins.has(p.halPin);
    constants[`pins.all.${i}.capabilities.interrupt`] = true;
    constants[`pins.all.${i}.capabilities.pullUp`] = true;
    constants[`pins.all.${i}.capabilities.pullDown`] = true;
    constants[`pins.all.${i}.capabilities.touch`] = false;
    constants[`pins.all.${i}.capabilities.openDrain`] = true;
  });
  constants['peripherals.i2c.count'] = i2cCount;
  constants['peripherals.spi.count'] = spiCount;
  constants['peripherals.uart.count'] = uartCount;
  for (let i = 0; i < i2cCount; i++) constants[`peripherals.i2c.${i}.instance`] = i;
  for (let i = 0; i < spiCount; i++) constants[`peripherals.spi.${i}.instance`] = i;
  for (let i = 0; i < uartCount; i++) constants[`peripherals.uart.${i}.instance`] = i;
  // Board pwm-led specs (virtual pins 8192+, dtSpec = the board's alias).
  // resolveChip/chipForBuild merge these into the active chip's pwm specs.
  pwmLedSpecs.forEach((l, i) => {
    constants[`zephyr.pwm.specs.${i}.pin`] = 8192 + i;
    constants[`zephyr.pwm.specs.${i}.dtSpec`] = l.alias!;
  });
  if (ledPin) constants['pins.aliases.LED'] = ledPin.name;
  if (buttonPin) constants['pins.aliases.BUTTON'] = buttonPin.name;

  // Extra LEDs / buttons beyond the canonical first — the pack carries them
  // as extraLeds/extraButtons with their own dtSpecs. Indexed aliases
  // INCLUDE the canonical first: LED0 = the first (same as LED), LED1 =
  // the second, etc. (the dtSpec numbering led0, led1, led2 lines up).
  if (ledPin) constants['pins.aliases.LED0'] = ledPin.name;
  if (buttonPin) constants['pins.aliases.BUTTON0'] = buttonPin.name;
  (entry.extraLeds ?? []).forEach((l, i) => {
    const p = placeDts(l);
    if (p) {
      constants[`pins.aliases.LED${i + 1}`] = p.name;
      if (!pins.some((x) => x.ident === p.ident)) pins.push(p);
    }
  });
  (entry.extraButtons ?? []).forEach((b, i) => {
    const p = placeDts(b);
    if (p) {
      constants[`pins.aliases.BUTTON${i + 1}`] = p.name;
      if (!pins.some((x) => x.ident === p.ident)) pins.push(p);
    }
  });

  // Connector labels (D0–D20, A0–A10, SDA/SCL/MOSI/MISO/SCK/RX/TX/CS,
  // GP0–GP29, …) — the pack's connector gpio-maps carry the board's
  // silkscreen labels mapped to controller+pin. Every one becomes a
  // pins.aliases.<label> entry so `resolveHALReceiver` treats them as Pin
  // constants (the same path LED/BUTTON ride). The board.ts export already
  // exists (connectorExports); this makes the manifest agree.
  for (const { label, pin } of connectorExports) {
    if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(label)) {
      constants[`pins.aliases.${label}`] = pin.name;
    }
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

  // Probe methods (the curated soc descriptor's table) — the debug-config
  // writer reads them from the board constants as zephyr.probeMethods.N.*.

  // ── Tier-3 GPIO controller routing ─────────────────────────────────────
  // Without a curated soc descriptor the strategy has no controller table,
  // and the GPIO lowering defaults to `gpio0` — a controller that doesn't
  // exist on STM32/Renesas/etc boards (the C++ fails with
  // `__device_dts_ord_DT_N_NODELABEL_gpio0_ORD was not declared`). The
  // derived table (deriveTier3Controllers, keyed off the controller names
  // present in the pack's DTS facts per vendor-family port conventions)
  // feeds resolveChipFromBoard through these constants.
  (tier3Table ?? []).forEach((c, i) => {
    constants[`zephyr.gpioControllers.${i}.nodelabel`] = c.nodelabel;
    constants[`zephyr.gpioControllers.${i}.minPin`] = c.minPin;
    constants[`zephyr.gpioControllers.${i}.maxPin`] = c.maxPin;
  });

  // Probe methods — the debug-config writer and `west flash` runner choice
  // read them from the board constants as zephyr.probeMethods.N.*. The
  // curated soc descriptor's table wins, with pack-only methods (from the
  // board's board.cmake runners) appended so every id the create wizard
  // offered resolves; tier-3 boards (no curated descriptor) ride the pack's
  // own table, so `zephyr.probe` resolves on every board.
  const probeTable = [...(chip?.probeMethods ?? [])];
  for (const pm of entry.probeMethods ?? []) {
    if (!probeTable.some((m) => m.id === pm.id)) probeTable.push(pm as ZephyrProbeMethod);
  }
  probeTable.forEach((pm, i) => {
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
    tier,
    pinNames: pins.map((p) => p.name),
    constants,
  };

  return {
    boardTs: ts.join('\n'),
    boardJson: JSON.stringify(manifest, null, 1),
    board: entry,
    chip,
  };
}
