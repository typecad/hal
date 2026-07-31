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
import { controllerNodelabelForPin } from '../chips/controllers.js';

/** The C variable prefix for a controller's state. */
function prefix(idx: number): string {
  return `__tc_spi${idx}`;
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
    `        ${p}_cfg.bus = ${p}_dev;`,
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
    case 'spi.begin':
      return { code: `${p}_init();` };
    case 'spi.end':
      return { code: `spi_release(${p}_dev, &${p}_cfg);` };
    case 'spi.begin_transaction':
      // Config is static; transaction begin is a no-op (frequency/mode baked in).
      return { code: `${p}_init();` };
    case 'spi.end_transaction':
      return { code: `(void)0;` };
    case 'spi.set_mode':
      // Apply CPOL/CPHA: store the mode byte then re-init so the next transfer
      // picks up the rebuilt operation flags. The ready flag is cleared so
      // _init() rebuilds rather than early-returning.
      return { code: `{ ${p}_mode = static_cast<uint8_t>(${o.mode}); ${p}_ready = false; ${p}_init(); }` };
    case 'spi.set_bit_order':
      // LSBFIRST (numeric 1, or Arduino ordinal 2) → lsb true; MSBFIRST/0 → false.
      // MSB is the safe default; numeric orders are the canonical HAL payload.
      return { code: `{ ${p}_lsb = (${o.order} == 1 || (${o.order}) == 2); ${p}_ready = false; ${p}_init(); }` };
    case 'spi.transfer': {
      // Single-byte full-duplex, returns the received byte (GCC stmt-expr).
      return {
        expression: `({ uint8_t __tx = static_cast<uint8_t>(${o.data}); uint8_t __rx = 0; struct spi_buf __tb = { .buf = &__tx, .len = 1 }; struct spi_buf_set __tbs = { .buffers = &__tb, .count = 1 }; struct spi_buf __rb = { .buf = &__rx, .len = 1 }; struct spi_buf_set __rbs = { .buffers = &__rb, .count = 1 }; ${p}_init(); spi_transceive(${p}_dev, &${p}_cfg, &__tbs, &__rbs); __rx; })`,
      };
    }
    case 'spi.read_buffer': {
      // Read count bytes by sending 0xFF dummy bytes (full-duplex read).
      const count = o.count;
      return {
        code: `{ uint8_t __dummy[${count}] = {0}; for (int __i = 0; __i < (int)(${count}); __i++) __dummy[__i] = 0xFF; struct spi_buf __tb = { .buf = __dummy, .len = ${count} }; struct spi_buf_set __tbs = { .buffers = &__tb, .count = 1 }; struct spi_buf __rb = { .buf = (void*)${o.buffer}, .len = ${count} }; struct spi_buf_set __rbs = { .buffers = &__rb, .count = 1 }; ${p}_init(); spi_transceive(${p}_dev, &${p}_cfg, &__tbs, &__rbs); }`,
      };
    }
    case 'spi.cs_low':
    case 'spi.cs_high': {
      // CS driven as a plain GPIO via the owning controller (the CS pin comes
      // from the op's `pin` field; Zephyr uses gpio_pin_set_raw). Resolve the
      // controller by pin so a CS on a high-numbered pin (ESP32-S3 gpio1) lands
      // on the right node.
      const val = op.operation === 'spi.cs_low' ? 0 : 1;
      const gpioController = controllerNodelabelForPin(chip, o.pin);
      return {
        code: `gpio_pin_set_raw(DEVICE_DT_GET(DT_NODELABEL(${gpioController})), ${o.pin}, ${val});`,
      };
    }
    default:
      throw new Error(
        `framework-zephyr does not yet support HAL op \`${op.operation}\`. ` +
          `Open an issue or use rawCpp() to emit it manually.`,
      );
  }
}
