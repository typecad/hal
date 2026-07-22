import type { HALOpIR } from '@typecad/cuttlefish/api/shared';
import { getActiveChip } from '../chips/index.js';
import { parseControllerIndex } from './util.js';

export function i2cInitLines(controllerIndex: number): string[] {
  const chip = getActiveChip();
  const cfg = chip.i2c.controllers[controllerIndex];
  if (!cfg) throw new Error(`I2C controller ${controllerIndex} not present on ${chip.id}`);
  return [
    `// CUTTLEFISH_I2C_BEGIN`,
    `// User I2C device handle — the bus itself is shared via __esp32_i2c_bus_get().`,
    `// This avoids the B1 bug where each I2C consumer independently calling`,
    `// i2c_new_master_bus() on the same port fails silently for the second caller.`,
    `static i2c_master_dev_handle_t __tc_i2c${controllerIndex}_dev = NULL;`,
    `static uint16_t __tc_i2c${controllerIndex}_addr = 0xFFFF;`,
    `static uint32_t __tc_i2c${controllerIndex}_clk = 100000;`,
    `static uint8_t __tc_i2c${controllerIndex}_txbuf[32];`,
    `static size_t  __tc_i2c${controllerIndex}_txlen = 0;`,
    `static uint8_t __tc_i2c${controllerIndex}_rxbuf[32];`,
    `static size_t  __tc_i2c${controllerIndex}_rxlen = 0;`,
    `static size_t  __tc_i2c${controllerIndex}_rxpos = 0;`,
    `static void __tc_i2c${controllerIndex}_init(void) {`,
    `    // Bus is created idempotently by the shared store; fetch the handle.`,
    `    (void)__esp32_i2c_bus_get(${controllerIndex});`,
    `}`,
    `// CUTTLEFISH_I2C_END`,
    ``,
  ];
}

/** Resolve a HAL i2c.* op to ESP-IDF C++. */
export function lowerI2c(op: HALOpIR): { code?: string; expression?: string } {
  const o = op as any;
  const idx = parseControllerIndex(o.bus);

  switch (op.operation) {
    case 'i2c.begin':
      return { code: `__tc_i2c${idx}_init();` };
    case 'i2c.set_clock':
      // Store the requested clock; applied when the device is (re)added.
      return { code: `__tc_i2c${idx}_clk = ${o.hz};` };
    case 'i2c.begin_transmission': {
      const addr = o.address;
      return { code: [
        `if (!__tc_i2c${idx}_dev || __tc_i2c${idx}_addr != (uint16_t)(${addr})) {`,
        `    if (__tc_i2c${idx}_dev) { i2c_master_bus_rm_device(__tc_i2c${idx}_dev); __tc_i2c${idx}_dev = NULL; }`,
        `    const i2c_device_config_t dcfg = { .dev_addr_length = I2C_ADDR_BIT_LEN_7, .device_address = ${addr}, .scl_speed_hz = __tc_i2c${idx}_clk };`,
        `    i2c_master_bus_add_device(__esp32_i2c_bus_get(${idx}), &dcfg, &__tc_i2c${idx}_dev);`,
        `    __tc_i2c${idx}_addr = (uint16_t)(${addr});`,
        `}`,
        `__tc_i2c${idx}_txlen = 0;`,
      ].join(' ') };
    }
    case 'i2c.write':
      return { code: `__tc_i2c${idx}_txbuf[__tc_i2c${idx}_txlen++] = (${o.data});` };
    case 'i2c.write_bytes': {
      const stmts = (o.bytes as (number | string)[]).map((b) => `__tc_i2c${idx}_txbuf[__tc_i2c${idx}_txlen++] = (${b});`);
      return { code: stmts.join(' ') };
    }
    case 'i2c.write_buffer':
      // Copy the user's buffer into the txbuf. Data is a C array/buffer variable name.
      // We emit a loop since we don't know the buffer length at transpile time.
      // The HAL op carries `data` (buffer name) — we copy up to txbuf capacity.
      return { code: `for (size_t __i = 0; __i < sizeof(${o.data}) && __tc_i2c${idx}_txlen < sizeof(__tc_i2c${idx}_txbuf); __i++) __tc_i2c${idx}_txbuf[__tc_i2c${idx}_txlen++] = ${o.data}[__i];` };
    case 'i2c.end_transmission':
      return { code: `i2c_master_transmit(__tc_i2c${idx}_dev, __tc_i2c${idx}_txbuf, __tc_i2c${idx}_txlen, -1);` };
    case 'i2c.request_from': {
      const qty = o.quantity;
      return { code: [
        `i2c_master_receive(__tc_i2c${idx}_dev, __tc_i2c${idx}_rxbuf, ${qty}, -1);`,
        `__tc_i2c${idx}_rxlen = ${qty}; __tc_i2c${idx}_rxpos = 0;`,
      ].join(' ') };
    }
    case 'i2c.available':
      return { expression: `(__tc_i2c${idx}_rxlen - __tc_i2c${idx}_rxpos)` };
    case 'i2c.read':
      return { expression: `__tc_i2c${idx}_rxbuf[__tc_i2c${idx}_rxpos++]` };
    case 'i2c.read_buffer': {
      // Read into the user's buffer variable. Buffer is the variable name;
      // count is the number of bytes.
      return { code: [
        `i2c_master_receive(__tc_i2c${idx}_dev, (uint8_t*)${o.buffer}, ${o.count}, -1);`,
      ].join(' ') };
    }
    case 'i2c.recover':
      // Reset the I2C bus if stuck (IDF v5: i2c_master_bus_reset)
      return { code: `i2c_master_bus_reset(__esp32_i2c_bus_get(${idx}));` };
    case 'i2c.end':
      // Remove this consumer's device handle; the shared bus persists for other consumers.
      return { code: `if (__tc_i2c${idx}_dev) { i2c_master_bus_rm_device(__tc_i2c${idx}_dev); __tc_i2c${idx}_dev = NULL; __tc_i2c${idx}_addr = 0xFFFF; }` };
    default:
      throw new Error(`framework-esp32 does not yet support HAL op \`${op.operation}\`.`);
  }
}
