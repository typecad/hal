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
  return `(void)${p}_dev;`;
}

/** The thin-device bus-speed preamble: apply the construction hz once
 *  (i2c_configure with Zephyr's I2C_SPEED_SET tier mapping), or '' when the
 *  target constructed without hz. Guarded per controller, so the cost after
 *  the first op is one bool test. */
function i2cSpeedGuard(p: string, hz: unknown): string {
  const n = typeof hz === 'number' ? hz : parseInt(String(hz ?? 0), 10);
  if (!n || isNaN(n)) return '';
  const speed = speedForHz(n);
  const done = `${p}_spd_done`;
  return `{ static bool ${done} = false; if (!${done}) { (void)i2c_configure(${p}_dev, I2C_SPEED_SET(${speed})); ${done} = true; } } `;
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
    // ── Thin I2C device (hal/i2c-target.ts) — Zephyr register verbs ──────
    // One call per op against the controller device handle; the optional
    // construction hz applies once via a guarded i2c_configure (the same
    // call i2c.set_clock lowers to).
    case 'i2c.reg_write': {
      const pre = i2cSpeedGuard(p, o.hz);
      return { code: `${pre} i2c_reg_write_byte(${p}_dev, static_cast<uint16_t>(${o.address}), static_cast<uint8_t>(${o.reg}), static_cast<uint8_t>(${o.value}));` };
    }
    case 'i2c.reg_read': {
      const pre = i2cSpeedGuard(p, o.hz);
      return { expression: `({ ${pre} uint8_t __v = 0; (void)i2c_reg_read_byte(${p}_dev, static_cast<uint16_t>(${o.address}), static_cast<uint8_t>(${o.reg}), &__v); __v; })` };
    }
    case 'i2c.reg_update': {
      const pre = i2cSpeedGuard(p, o.hz);
      return { code: `${pre} (void)i2c_reg_update_byte(${p}_dev, static_cast<uint16_t>(${o.address}), static_cast<uint8_t>(${o.reg}), static_cast<uint8_t>(${o.mask}), static_cast<uint8_t>(${o.value}));` };
    }
    case 'i2c.dev_write': {
      const pre = i2cSpeedGuard(p, o.hz);
      const bytes: unknown[] = o.bytes ?? [];
      // Identifier-shaped only — a single-byte literal array arrives as
      // numeric text ("159") and must take the literal path.
      const isBuffer = bytes.length === 1 && typeof bytes[0] === 'string' && /^[A-Za-z_][A-Za-z0-9_]*$/.test(bytes[0] as string);
      if (isBuffer) {
        const name = bytes[0] as string;
        // A named user buffer: i2c_write against its storage directly.
        return { code: `${pre} (void)i2c_write(${p}_dev, reinterpret_cast<const uint8_t*>(${name}), sizeof(${name}), static_cast<uint16_t>(${o.address}));` };
      }
      const arr = `static const uint8_t __tc_i2cw[] = { ${bytes.join(', ')} };`;
      return { code: `${pre} ${arr} (void)i2c_write(${p}_dev, __tc_i2cw, sizeof(__tc_i2cw), static_cast<uint16_t>(${o.address}));` };
    }
    default:
      throw new Error(
        `framework-zephyr does not yet support HAL op \`${op.operation}\`. ` +
          `Open an issue or use rawCpp() to emit it manually.`,
      );
  }
}
