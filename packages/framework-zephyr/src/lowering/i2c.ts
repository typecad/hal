// ---------------------------------------------------------------------------
// I2C lowering — transactional txbuf accumulator + per-call i2c_write
//
// Mirrors the ESP32 stateful model but simpler: Zephyr's `i2c_write(bus, buf,
// len, addr)` takes the address per-call, so there's no device-handle cache.
// The begin_transmission → write* → end_transmission sequence accumulates into
// `__tc_i2c<N>_txbuf` and flushes as one `i2c_write` at end_transmission.
// Reads go through request_from → i2c_read into `__tc_i2c<N>_rxbuf`, consumed
// by subsequent i2c.read / i2c.available calls.
//
// The device handle resolves at compile time via DEVICE_DT_GET(DT_NODELABEL(...)).
// ---------------------------------------------------------------------------

import type { HALOpIR } from '@typecad/cuttlefish/api/shared';
import type { ZephyrChipDescriptor } from '../chips/types.js';
import { parseControllerIndex } from './util.js';

const TXBUF_SIZE = 32;
const RXBUF_SIZE = 32;

/** The C variable prefix for a controller's state. */
function prefix(idx: number): string {
  return `__tc_i2c${idx}`;
}

/**
 * Emit the per-controller I2C state. Called from shimLines for each
 * controller the program uses (gated on ctx.analysis.usesI2C).
 */
export function i2cInitLines(chip: ZephyrChipDescriptor, controllerIndex: number): string[] {
  const ctrl = chip.i2c?.controllers[controllerIndex];
  if (!ctrl) return [];
  const p = prefix(controllerIndex);
  return [
    '// CUTTLEFISH_I2C_BEGIN',
    `static const struct device* ${p}_dev = DEVICE_DT_GET(DT_NODELABEL(${ctrl.nodeLabel}));`,
    `static uint16_t ${p}_addr = 0xFFFF;`,
    `static uint8_t ${p}_txbuf[${TXBUF_SIZE}];`,
    `static size_t ${p}_txlen = 0;`,
    `static uint8_t ${p}_rxbuf[${RXBUF_SIZE}];`,
    `static size_t ${p}_rxlen = 0;`,
    `static size_t ${p}_rxpos = 0;`,
    '// CUTTLEFISH_I2C_END',
  ];
}

/** Map a clock speed in Hz to an I2C_SPEED_* define. */
function speedForHz(hz: number): string {
  if (hz <= 100_000) return 'I2C_SPEED_STANDARD';
  if (hz <= 400_000) return 'I2C_SPEED_FAST';
  if (hz <= 1_000_000) return 'I2C_SPEED_FAST_PLUS';
  return 'I2C_SPEED_HIGH';
}

/**
 * The (void) comma expression begin/end lower to — a no-op that references
 * the controller's whole state block (device + transaction buffers) so a
 * program calling only begin() stays -Werror clean (-Wunused-variable).
 */
function i2cKeepAlive(p: string): string {
  return `(void)${p}_dev, (void)${p}_addr, (void)${p}_txbuf, (void)${p}_txlen, (void)${p}_rxbuf, (void)${p}_rxlen, (void)${p}_rxpos;`;
}

/**
 * Resolve a HAL i2c.* op to Zephyr C++.
 * Returns `{ code }` for statement ops, `{ expression }` for value-returning ops.
 */
export function lowerI2c(
  op: HALOpIR,
  chip: ZephyrChipDescriptor,
): { code?: string; expression?: string } {
  const o = op as any;
  const idx = parseControllerIndex(o.bus);
  const p = prefix(idx);

  switch (op.operation) {
    case 'i2c.begin':
      // Zephyr resolves the device at compile time; begin is a no-op (device
      // ready check is folded into the driver calls). The comma expression
      // references the transaction state so a program that only calls begin()
      // (no transactions yet) keeps every shim variable used — Zephyr builds
      // with -Werror and -Wunused-variable would otherwise fail it.
      return { code: i2cKeepAlive(p) };
    case 'i2c.end':
      return { code: i2cKeepAlive(p) };
    case 'i2c.set_clock': {
      const hz = typeof o.hz === 'number' ? o.hz : parseInt(String(o.hz), 10);
      const speed = isNaN(hz) ? 'I2C_SPEED_STANDARD' : speedForHz(hz || 100000);
      return { code: `i2c_configure(${p}_dev, I2C_SPEED_SET(${speed}));` };
    }
    case 'i2c.begin_transmission':
      // Record the target address + reset the pending write buffer.
      return { code: `${p}_addr = static_cast<uint16_t>(${o.address}); ${p}_txlen = 0;` };
    case 'i2c.write':
      // Append one byte (clamped to capacity).
      return { code: `if (${p}_txlen < ${TXBUF_SIZE}) { ${p}_txbuf[${p}_txlen++] = static_cast<uint8_t>(${o.data}); }` };
    case 'i2c.write_bytes': {
      const bytes: unknown[] = o.bytes ?? [];
      const stmts = bytes.map(
        (b) => `if (${p}_txlen < ${TXBUF_SIZE}) { ${p}_txbuf[${p}_txlen++] = static_cast<uint8_t>(${b}); }`,
      );
      return { code: stmts.join(' ') };
    }
    case 'i2c.write_buffer': {
      // Copy from a user buffer (its name is o.data), clamped to capacity.
      return {
        code: `for (size_t __i = 0; __i < sizeof(${o.data}) && ${p}_txlen < ${TXBUF_SIZE}; __i++) { ${p}_txbuf[${p}_txlen++] = reinterpret_cast<const uint8_t*>(${o.data})[__i]; }`,
      };
    }
    case 'i2c.end_transmission':
      // Flush the accumulated txbuf to the cached address.
      return { code: `i2c_write(${p}_dev, ${p}_txbuf, ${p}_txlen, ${p}_addr);` };
    case 'i2c.request_from': {
      const qty = o.quantity;
      return {
        code: `i2c_read(${p}_dev, ${p}_rxbuf, static_cast<uint32_t>(${qty}), static_cast<uint16_t>(${o.address})); ${p}_rxlen = ${qty}; ${p}_rxpos = 0;`,
      };
    }
    case 'i2c.available':
      return { expression: `(${p}_rxlen - ${p}_rxpos)` };
    case 'i2c.read':
      return { expression: `(${p}_rxpos < ${p}_rxlen ? ${p}_rxbuf[${p}_rxpos++] : -1)` };
    case 'i2c.read_buffer': {
      // Read straight into the user's buffer (o.buffer), count bytes. When the
      // caller discards the result (readByte()/readBytes() as a bare
      // statement), the IR carries the __HAL_READ_BUF__ placeholder — the
      // var-init rewrite never runs, so fall back to a local scratch buffer.
      const count = o.count;
      if (o.buffer === '__HAL_READ_BUF__') {
        return {
          code: `{ uint8_t __tc_rdbuf[${count}]; i2c_read(${p}_dev, __tc_rdbuf, static_cast<uint32_t>(${count}), ${p}_addr); }`,
        };
      }
      return {
        code: `i2c_read(${p}_dev, reinterpret_cast<uint8_t*>(${o.buffer}), static_cast<uint32_t>(${count}), ${p}_addr);`,
      };
    }
    case 'i2c.recover':
      return { code: `i2c_recover_bus(${p}_dev);` };
    default:
      throw new Error(
        `framework-zephyr does not yet support HAL op \`${op.operation}\`. ` +
          `Open an issue or use rawCpp() to emit it manually.`,
      );
  }
}
