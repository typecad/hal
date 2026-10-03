// ---------------------------------------------------------------------------
// zephyr.buses — config-specified bus pin assignments (the ESP32 pin matrix)
//
// ESP32-family SoCs route every controller through a GPIO matrix: any pad
// can carry any peripheral signal, and the SoC dtsi ships the controllers
// DISABLED until a board overlay pins them. A board whose default
// devicetree wires none (esp32s3_devkitc ships i2c0/i2c1 disabled) has
// zero available I2C — not a silicon limit, a wiring fact. The
// `zephyr.buses` config section states the wiring:
//
//   zephyr: {
//     buses: {
//       i2c0: { sda: 8, scl: 9 },
//       spi0: { sck: 12, mosi: 11, miso: 13 },   // SPI0 = the SoC's GPSPI2
//       uart1: { tx: 17, rx: 18 },
//     },
//   }
//
// Each entry becomes a bus controller with a SYNTHESIZED pinctrl group
// (the esp32<soC>-pinctrl.h named macros — the same remux shape the
// display/touch overlay path pioneered). From there the existing
// machinery carries it end to end: the board module exports the I2C0/
// SPI0/UART1 singletons and gates the HAL classes on them, the
// peripherals.<bus>.count constants raise the capacity validator, the
// chip view reconstructs the controller (nodeLabel + pinctrl synthesis)
// for the C++ shims, and the overlay emits the &pinctrl group + enables
// the controller with pinctrl-0.
// ----------------------------------------------------------------------------

/** One config-specified bus wiring, normalized. */
export interface BusPinSpec {
  kind: 'i2c' | 'spi' | 'uart';
  /** HAL selector index (I2C0 → 0). */
  index: number;
  /** Devicetree nodelabel the index maps to on this SoC family. */
  nodeLabel: string;
  /** Distinct pinctrl group label (the board's own <label>_default may
   *  already exist — redefining it is a DT error). */
  groupName: string;
  /** The esp32<soC>-pinctrl.h include for the macro tokens. */
  include: string;
  /** Output-signal pinmux macros (group1). */
  pinmux: string[];
  /** The raw pin record as configured (for diagnostics). */
  raw: Record<string, number>;
}

export interface BusPinsResult {
  specs: BusPinSpec[];
  warnings: string[];
}

const BUS_KEY_RE = /^(i2c|spi|uart)([0-9]+)$/;

/** The ESP32 family's index→nodelabel convention: I2C/UART map directly
 *  (i2c0, uart1); the general-purpose SPI controllers are the SoC's
 *  GPSPI2/GPSPI3, so HAL SPI0 → spi2. */
function nodeLabelFor(kind: 'i2c' | 'spi' | 'uart', index: number): string {
  if (kind === 'spi') return `spi${index + 2}`;
  return `${kind}${index}`;
}

/** Macro token for one signal on one pad — the named-macro form every
 *  esp32*-pinctrl.h ships (I2C0_SDA_GPIO8, SPIM2_SCLK_GPIO12,
 *  UART1_TX_GPIO17). */
function token(prefix: string, pin: number): string {
  return `${prefix}_GPIO${pin}`;
}

/**
 * Parse + validate the `zephyr.buses` config record into synthesized
 * controller specs. `soc` is the board's SoC name (the catalog entry's
 * soc field, e.g. 'esp32s3'); only the ESP32 family supports pin-matrix
 * remux — other SoCs get a warning naming their fixed-pin reality.
 */
export function parseBusPins(
  raw: Record<string, Record<string, number>> | undefined,
  soc: string,
): BusPinsResult {
  const warnings: string[] = [];
  const specs: BusPinSpec[] = [];
  if (!raw || typeof raw !== 'object') return { specs, warnings };

  const isEsp32Family = /^esp32/.test(soc);
  // The pinmux macros live in <soc>-pinctrl.h but EXPAND through
  // ESP32_PINMUX (esp-pinctrl-common.h) with signal IDs from
  // <soc>-gpio-sigmap.h — the reference board pinctrl dtsis include all
  // three; the overlay must too (a merged preprocess without sigmap leaves
  // the macro unexpanded — a bare identifier the DT grammar rejects).
  // BARE paths — the overlay generator emits `#include <${include}>` itself
  // (the RP2xxx pinctrl.include convention), so angle brackets here doubled.
  const pinmuxIncludes = [
    'zephyr/dt-bindings/pinctrl/esp-pinctrl-common.h',
    `zephyr/dt-bindings/pinctrl/${soc}-pinctrl.h`,
    `zephyr/dt-bindings/pinctrl/${soc}-gpio-sigmap.h`,
  ];
  const include = pinmuxIncludes.join(',');

  for (const [key, pins] of Object.entries(raw)) {
    const m = BUS_KEY_RE.exec(key);
    if (!m) {
      warnings.push(`buses.${key}: not a bus selector (expected i2c0, spi0, uart1, …) — ignored.`);
      continue;
    }
    const kind = m[1] as 'i2c' | 'spi' | 'uart';
    const index = Number(m[2]);
    if (!isEsp32Family) {
      warnings.push(`buses.${key}: bus pin remux is an ESP32-family capability (the GPIO matrix); this SoC's pins come from its board devicetree — ignored.`);
      continue;
    }

    const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
    let pinmux: string[] | undefined;
    if (kind === 'i2c') {
      const sda = num(pins.sda);
      const scl = num(pins.scl);
      if (sda === undefined || scl === undefined) {
        warnings.push(`buses.${key}: i2c needs both sda and scl — ignored.`);
        continue;
      }
      pinmux = [token(`I2C${index}_SDA`, sda), token(`I2C${index}_SCL`, scl)];
    } else if (kind === 'spi') {
      const sck = num(pins.sck);
      const mosi = num(pins.mosi);
      const miso = num(pins.miso);
      if (sck === undefined || mosi === undefined) {
        warnings.push(`buses.${key}: spi needs at least sck and mosi (miso optional) — ignored.`);
        continue;
      }
      const ctrl = index + 2;
      pinmux = [token(`SPIM${ctrl}_SCLK`, sck), token(`SPIM${ctrl}_MOSI`, mosi)];
      if (miso !== undefined) pinmux.push(token(`SPIM${ctrl}_MISO`, miso));
    } else {
      const tx = num(pins.tx);
      const rx = num(pins.rx);
      if (tx === undefined || rx === undefined) {
        warnings.push(`buses.${key}: uart needs both tx and rx — ignored.`);
        continue;
      }
      pinmux = [token(`UART${index}_TX`, tx), token(`UART${index}_RX`, rx)];
    }

    specs.push({
      kind,
      index,
      nodeLabel: nodeLabelFor(kind, index),
      groupName: `${nodeLabelFor(kind, index)}_tc_remux`,
      include,
      pinmux,
      raw: pins,
    });
  }

  return { specs, warnings };
}
