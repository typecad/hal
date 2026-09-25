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

// ── I2C responder (hal/i2c-responder.ts) — this board as an I2C target ────
//
// One state block per constructed responder (bus + address), the i2c_target
// vocabulary verbatim: the five driver callbacks behind two user-facing ones
// (onReceive fires at STOP with the receive ring's new byte count; onRequest
// fires at read start — the write() refill point). Registration
// (i2c_target_register) is once-guarded at the first op, against the
// controller handle the master-side init block emitted (__tc_i2c<N>_dev).

/** The C symbol prefix for one responder's state. */
function respPrefix(idx: number, address: number): string {
  return `__tc_i2cresp${idx}_a${address.toString(16)}`;
}

/** The once-guarded registration every responder op carries — the UART arm
 *  discipline: the first emitted call registers the address, so the
 *  callbacks installed early in setup make it answer from boot. An
 *  unsupported controller prints loudly (the CAN policy: -ENOSYS from a
 *  driver with no target mode must not be a silent empty responder). */
function respRegisterGuard(p: string, idx: number): string {
  return `{ if (!${p}_registered) { ${p}_registered = true; int __tc_err = i2c_target_register(__tc_i2c${idx}_dev, &${p}_cfg); if (__tc_err != 0) { printk("typecad-hal i2c responder: target_register failed: %d\\n", __tc_err); } } } `;
}

/**
 * Emit one responder's state: receive ring (UART discipline — free-running
 * head/tail, overflow-drop), response buffer with its served position, the
 * two handler slots, the five i2c_target callbacks, and the config the ops'
 * registration guard passes to i2c_target_register. Called from shimLines
 * for each constructed responder (collectI2cResponders).
 */
export function i2cResponderStateLines(chip: ZephyrChipDescriptor, controllerIndex: number, address: number, rx: number, tx: number): string[] {
  const ctrl = chip.i2c?.controllers[controllerIndex];
  if (!ctrl) return [];
  const p = respPrefix(controllerIndex, address);
  return [
    '// CUTTLEFISH_I2CRESP_BEGIN',
    `static uint8_t ${p}_rx[${rx}];`,
    `static volatile uint32_t ${p}_head = 0;`,
    `static volatile uint32_t ${p}_tail = 0;`,
    `static uint8_t ${p}_tx[${tx}];`,
    `static volatile uint32_t ${p}_txlen = 0;`,
    `static volatile uint32_t ${p}_txpos = 0;`,
    `static void (*${p}_on_rx)(double) = NULL;`,
    `static void (*${p}_on_rq)(void) = NULL;`,
    // A controller write transaction: reset the ring, then take each byte.
    // A byte arriving with a full ring is dropped — the embedded-honest
    // answer (no unbounded buffering), same as the UART RX ring.
    `static int ${p}_write_requested(struct i2c_target_config* cfg) {`,
    '    (void)cfg;',
    `    ${p}_head = 0;`,
    `    ${p}_tail = 0;`,
    '    return 0;',
    '}',
    `static int ${p}_write_received(struct i2c_target_config* cfg, uint8_t val) {`,
    '    (void)cfg;',
    `    if ((${p}_head - ${p}_tail) < ${rx}U) {`,
    `        ${p}_rx[${p}_head % ${rx}U] = val;`,
    `        ${p}_head++;`,
    '    }',
    '    return 0;',
    '}',
    // A controller read transaction: the user's refill point first, then the
    // first byte. Past the buffer's end the controller reads 0xFF (the bus
    // has no NACK for a too-long read; the value is the honest filler).
    `static int ${p}_read_requested(struct i2c_target_config* cfg, uint8_t* val) {`,
    '    (void)cfg;',
    `    if (${p}_on_rq != NULL) { ${p}_on_rq(); }`,
    `    ${p}_txpos = 1U;`,
    `    *val = (${p}_txlen > 0U) ? ${p}_tx[0] : 0xFFU;`,
    '    return 0;',
    '}',
    `static int ${p}_read_processed(struct i2c_target_config* cfg, uint8_t* val) {`,
    '    (void)cfg;',
    `    *val = (${p}_txpos < ${p}_txlen) ? ${p}_tx[${p}_txpos] : 0xFFU;`,
    `    ${p}_txpos++;`,
    '    return 0;',
    '}',
    // End of transaction: announce a completed controller write with the
    // count now waiting in the ring (the Wire onReceive(len) semantic).
    `static int ${p}_stop(struct i2c_target_config* cfg) {`,
    '    (void)cfg;',
    `    if ((${p}_on_rx != NULL) && (${p}_head > ${p}_tail)) {`,
    `        ${p}_on_rx(static_cast<double>(${p}_head - ${p}_tail));`,
    '    }',
    '    return 0;',
    '}',
    `static const struct i2c_target_callbacks ${p}_cbs = {`,
    `    .write_requested = ${p}_write_requested,`,
    `    .read_requested = ${p}_read_requested,`,
    `    .write_received = ${p}_write_received,`,
    `    .read_processed = ${p}_read_processed,`,
    `    .stop = ${p}_stop,`,
    '};',
    `static struct i2c_target_config ${p}_cfg = {`,
    '    .flags = 0U,',
    `    .address = ${address}U,`,
    `    .callbacks = &${p}_cbs,`,
    '};',
    `static bool ${p}_registered = false;`,
    '// CUTTLEFISH_I2CRESP_END',
  ];
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

    // ── I2C responder (hal/i2c-responder.ts) — target-mode ops ───────────
    // Every op carries the once-guarded registration; the state it touches
    // is the per-responder block i2cResponderStateLines emitted.
    case 'i2c.resp_on_receive': {
      const rp = respPrefix(idx, o.address);
      return { code: `${respRegisterGuard(rp, idx)} ${rp}_on_rx = ${o.handler};` };
    }
    case 'i2c.resp_on_request': {
      const rp = respPrefix(idx, o.address);
      return { code: `${respRegisterGuard(rp, idx)} ${rp}_on_rq = ${o.handler};` };
    }
    case 'i2c.resp_available': {
      const rp = respPrefix(idx, o.address);
      return { expression: `({ ${respRegisterGuard(rp, idx)} (${rp}_head - ${rp}_tail); })` };
    }
    case 'i2c.resp_read': {
      const rp = respPrefix(idx, o.address);
      return { expression: `({ ${respRegisterGuard(rp, idx)} (${rp}_tail < ${rp}_head ? ${rp}_rx[(${rp}_tail)++ % ${o.rx}U] : -1); })` };
    }
    case 'i2c.resp_write': {
      const rp = respPrefix(idx, o.address);
      const bytes: unknown[] = o.bytes ?? [];
      const isBuffer = bytes.length === 1 && typeof bytes[0] === 'string' && /^[A-Za-z_][A-Za-z0-9_]*$/.test(bytes[0] as string);
      if (isBuffer) {
        const name = bytes[0] as string;
        // A named user buffer: copy its storage into the response buffer,
        // clamped to the constructed size; the length lands last so an
        // in-flight read never sees a torn buffer.
        return {
          code: `${respRegisterGuard(rp, idx)} { ${rp}_txlen = 0U; for (uint32_t __tc_i = 0U; (__tc_i < sizeof(${name})) && (__tc_i < ${o.tx}U); ++__tc_i) { ${rp}_tx[__tc_i] = ${name}[__tc_i]; } ${rp}_txlen = (sizeof(${name}) < ${o.tx}U) ? static_cast<uint32_t>(sizeof(${name})) : ${o.tx}U; }`,
        };
      }
      if (bytes.length > Number(o.tx)) {
        throw new Error(
          `I2C responder write: the response buffer holds ${o.tx} bytes — got ${bytes.length}. Construct with a larger txBufferBytes.`,
        );
      }
      const assigns = bytes
        .map((b, i) => `${rp}_tx[${i}] = static_cast<uint8_t>(${b});`)
        .join(' ');
      return { code: `${respRegisterGuard(rp, idx)} { ${rp}_txlen = 0U; ${assigns} ${rp}_txlen = ${bytes.length}U; }` };
    }
    default:
      throw new Error(
        `framework-zephyr does not yet support HAL op \`${op.operation}\`. ` +
          `Open an issue or use rawCpp() to emit it manually.`,
      );
  }
}
