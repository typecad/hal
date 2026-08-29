// ---------------------------------------------------------------------------
// SPI lowering — spi_transceive_dt against a spi_dt_spec; CS as GPIO
//
// Zephyr's `spi_transceive_dt(&spec, tx, rx)` is stateless per-call, so there
// is no pending-tx-buffer (unlike I2C). The CS pin is driven as a plain GPIO
// (like ESP32), since the DT spec's CS handling is configured at compile time
// but the HAL's explicit cs_low/cs_high ops want manual control.
//
// The board's SPI node (spi2 on the XIAO) has no pre-declared client device
// node, so the lowering cannot use SPI_DT_SPEC_GET (which needs a client node).
// Instead we build a `struct spi_config` at runtime against
// DEVICE_DT_GET(DT_NODELABEL(spi2)) and call spi_transceive directly.
// ---------------------------------------------------------------------------

import type { HALOpIR } from '@typecad/cuttlefish/api/shared';
import type { ZephyrChipDescriptor } from '../chips/types.js';
import { parseControllerIndex } from './util.js';

/** The C variable prefix for a controller's state. */
function prefix(idx: number): string {
  return `__tc_spi${idx}`;
}

// ── Thin SPI device names — the shared-facts discipline ────────────────────
//
// The DT nodelabel (tc_spit_spi<N>_cs<cs>), the shim's spi_dt_spec var, and
// the overlay scanner's regex all derive from bus index + cs pin here.

export interface SpiTargetNames {
  dtLabel: string;
  varName: string;
  busIndex: number;
  cs: number;
}

/** Derive a thin SPI target's names from the op facts. */
export function spiTargetNames(bus: string, cs: number | string): SpiTargetNames {
  const busIndex = parseControllerIndex(typeof bus === 'string' ? bus : String(bus));
  const csNum = typeof cs === 'number' ? cs : parseInt(String(cs), 10);
  const stem = `spit_spi${busIndex}_cs${csNum}`;
  return { dtLabel: `tc_${stem}`, varName: `__tc_${stem}_spec`, busIndex, cs: csNum };
}

/** The per-target state block: one spi_dt_spec against the DT child node the
 *  overlay emits, plus the tc-spit-cfg comment the overlay scanner reads (the
 *  tc-sensor-cfg channel). Called from shimLines for each distinct target. */
export function spiTargetStateLines(bus: string, cs: number | string, hz: number | string = 0, mode: number | string = 0): string[] {
  const n = spiTargetNames(bus, cs);
  return [
    '// CUTTLEFISH_SPIT_BEGIN',
    // Zephyr 4.4's SPI_DT_SPEC_GET takes the base operation explicitly (mode
    // bits come from the DT node's spi-cpol/spi-cpha via SPI_CONFIG_DT).
    `static const struct spi_dt_spec ${n.varName} = SPI_DT_SPEC_GET(DT_NODELABEL(${n.dtLabel}), SPI_OP_MODE_MASTER | SPI_WORD_SET(8), 0);`,
    `// tc-spit-cfg: ${n.dtLabel} hz=${Number(hz)} mode=${Number(mode)}`,
    '// CUTTLEFISH_SPIT_END',
  ];
}

/** Build the tx buffer declaration + set for a thin SPI op. A literal byte
 *  array becomes a local array; a single identifier is the user's own buffer
 *  (its storage + sizeof drive length). spi_buf.buf is void*, and the user's
 *  buffer may be const-qualified — cast through const void* to stay legal
 *  under -Werror without mutating anyone's qualifications. */
function spiTxBuffers(tx: unknown, tag: string): { decl: string; set: string } {
  const bytes = (Array.isArray(tx) ? tx : []) as unknown[];
  // Only an identifier-shaped string is a real caller buffer — the resolver
  // collapses a single-byte literal array to buffer-kind with NUMERIC text
  // (e.g. "159"), which must take the literal path below.
  const isIdentifier = bytes.length === 1 && typeof bytes[0] === 'string' && /^[A-Za-z_][A-Za-z0-9_]*$/.test(bytes[0] as string);
  if (isIdentifier) {
    const name = bytes[0] as string;
    return {
      decl: `const struct spi_buf __tb${tag} = { .buf = const_cast<void*>(static_cast<const void*>(${name})), .len = sizeof(${name}) }; const struct spi_buf_set __txs${tag} = { .buffers = &__tb${tag}, .count = 1 };`,
      set: `__txs${tag}`,
    };
  }
  return {
    decl: `uint8_t __tx${tag}[] = { ${bytes.join(', ')} }; const struct spi_buf __tb${tag} = { .buf = __tx${tag}, .len = sizeof(__tx${tag}) }; const struct spi_buf_set __txs${tag} = { .buffers = &__tb${tag}, .count = 1 };`,
    set: `__txs${tag}`,
  };
}

/**
 * Emit the per-controller SPI state. The bus device resolves at compile time;
 * a static spi_config holds the base operation flags, and mutable runtime fields
 * hold the mode (CPOL/CPHA bits) + bit order (lsb) so set_mode/set_bit_order can
 * rebuild operation at init time (Zephyr's spi_config.operation is the only knob).
 */
export function spiInitLines(chip: ZephyrChipDescriptor, controllerIndex: number): string[] {
  const ctrl = chip.spi?.controllers[controllerIndex];
  if (!ctrl) return [];
  const p = prefix(controllerIndex);
  return [
    '// CUTTLEFISH_SPI_BEGIN',
    `static const struct device* ${p}_dev = DEVICE_DT_GET(DT_NODELABEL(${ctrl.nodeLabel}));`,
    `static bool ${p}_ready = false;`,
    `static uint8_t ${p}_mode = 0;   // bit0=CPOL, bit1=CPHA`,
    `static bool ${p}_lsb = false;   // false=MSB (default), true=LSB`,
    `static struct spi_config ${p}_cfg = {`,
    `    .frequency = 1000000,`,
    `};`,
    `static void ${p}_init(void) {`,
    `    if (!${p}_ready) {`,
    // NOTE: no .bus assignment — struct spi_config lost its `bus` member in
    // Zephyr 4.x (deprecated 3.5, removed 4.0); spi_transceive takes the
    // device alongside the config, which the ops below already do.
    `        ${p}_cfg.operation = SPI_OP_MODE_MASTER | SPI_WORD_SET(8)`,
    `            | (${p}_lsb ? SPI_TRANSFER_LSB : SPI_TRANSFER_MSB)`,
    `            | ((${p}_mode & 0x1) ? SPI_MODE_CPOL : 0)`,
    `            | ((${p}_mode & 0x2) ? SPI_MODE_CPHA : 0);`,
    `        ${p}_ready = true;`,
    `    }`,
    `}`,
    '// CUTTLEFISH_SPI_END',
  ];
}

/**
 * Resolve a HAL spi.* op to Zephyr C++.
 * Returns `{ code }` for statement ops, `{ expression }` for value-returning ops.
 */
export function lowerSpi(
  op: HALOpIR,
  chip: ZephyrChipDescriptor,
): { code?: string; expression?: string } {
  const o = op as any;
  const idx = parseControllerIndex(o.bus);
  const p = prefix(idx);

  switch (op.operation) {
    case 'spi.transceive': {
      const v = spiTargetNames(o.bus, o.cs).varName;
      const tx = spiTxBuffers(o.tx, 't');
      const rxName = String(o.rx ?? '');
      const rx = rxName
        ? `struct spi_buf __rb = { .buf = const_cast<void*>(static_cast<const void*>(${rxName})), .len = sizeof(${rxName}) }; const struct spi_buf_set __rbs = { .buffers = &__rb, .count = 1 };`
        : `const struct spi_buf_set __rbs = { .buffers = NULL, .count = 0 };`;
      return {
        code: `{ ${tx.decl} ${rx} (void)spi_transceive_dt(&${v}, &${tx.set}, &__rbs); }`,
      };
    }
    case 'spi.dev_write': {
      const v = spiTargetNames(o.bus, o.cs).varName;
      const tx = spiTxBuffers(o.tx, 'w');
      return {
        code: `{ ${tx.decl} (void)spi_write_dt(&${v}, &${tx.set}); }`,
      };
    }
    case 'spi.reg_read': {
      // One-byte register read against an INTERNAL buffer — no caller array
      // (sidesteps the file-scope Uint8Array promotion issue; also just the
      // right shape for ID/status registers).
      const v = spiTargetNames(o.bus, o.cs).varName;
      return {
        expression: `({ uint8_t __txr = static_cast<uint8_t>(${o.reg}); uint8_t __rxr = 0; struct spi_buf __tbr = { .buf = &__txr, .len = 1 }; const struct spi_buf_set __txsr = { .buffers = &__tbr, .count = 1 }; struct spi_buf __rbr = { .buf = &__rxr, .len = 1 }; const struct spi_buf_set __rxsr = { .buffers = &__rbr, .count = 1 }; (void)spi_transceive_dt(&${v}, &__txsr, &__rxsr); __rxr; })`,
      };
    }
    default:
      throw new Error(
        `framework-zephyr does not yet support HAL op \`${op.operation}\`. ` +
          `Open an issue or use rawCpp() to emit it manually.`,
      );
  }
}
