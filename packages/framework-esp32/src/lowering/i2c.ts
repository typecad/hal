import type { HALOpIR } from '@typecad/cuttlefish/api/shared';
import { getActiveChip } from '../chips/index.js';
import { parseControllerIndex } from './uart.js';

export function i2cInitLines(controllerIndex: number): string[] {
  const chip = getActiveChip();
  const cfg = chip.i2c.controllers[controllerIndex];
  if (!cfg) throw new Error(`I2C controller ${controllerIndex} not present on ${chip.id}`);
  return [
    `// CUTTLEFISH_I2C_BEGIN`,
    `static i2c_master_bus_handle_t __tc_i2c${controllerIndex}_bus = NULL;`,
    `static i2c_master_dev_handle_t __tc_i2c${controllerIndex}_dev = NULL;`,
    `static uint8_t __tc_i2c${controllerIndex}_txbuf[32];`,
    `static size_t  __tc_i2c${controllerIndex}_txlen = 0;`,
    `static uint8_t __tc_i2c${controllerIndex}_rxbuf[32];`,
    `static size_t  __tc_i2c${controllerIndex}_rxlen = 0;`,
    `static size_t  __tc_i2c${controllerIndex}_rxpos = 0;`,
    `static void __tc_i2c${controllerIndex}_init(void) {`,
    `    if (__tc_i2c${controllerIndex}_bus) return;`,
    `    const i2c_master_bus_config_t bcfg = {`,
    `        .i2c_port = ${cfg.host},`,
    `        .sda_io_num = ${cfg.defaultSda},`,
    `        .scl_io_num = ${cfg.defaultScl},`,
    `        .clk_source = I2C_CLK_SRC_DEFAULT,`,
    `        .glitch_ignore_cnt = 7,`,
    `        .flags = { .enable_internal_pullup = 1 },`,
    `    };`,
    `    i2c_new_master_bus(&bcfg, &__tc_i2c${controllerIndex}_bus);`,
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
      // Clock is set when the device handle is created on begin_transmission.
      // For v1, accept and ignore (documented).
      return { code: `/* i2c.set_clock(${o.hz}): applied at device-add time */` };
    case 'i2c.begin_transmission': {
      const addr = o.address;
      return { code: [
        `if (!__tc_i2c${idx}_dev) {`,
        `    const i2c_device_config_t dcfg = { .dev_addr_length = I2C_ADDR_BIT_LEN_7, .device_address = ${addr}, .scl_speed_hz = 100000 };`,
        `    i2c_master_bus_add_device(__tc_i2c${idx}_bus, &dcfg, &__tc_i2c${idx}_dev);`,
        `}`,
        `__tc_i2c${idx}_txlen = 0;`,
      ].join(' ') };
    }
    case 'i2c.write':
      // Single byte expression
      return { code: `__tc_i2c${idx}_txbuf[__tc_i2c${idx}_txlen++] = (${o.data});` };
    case 'i2c.write_bytes': {
      const stmts = (o.bytes as (number | string)[]).map((b) => `__tc_i2c${idx}_txbuf[__tc_i2c${idx}_txlen++] = (${b});`);
      return { code: stmts.join(' ') };
    }
    case 'i2c.write_buffer':
      // data is a buffer variable name; can't know length statically — caller
      // should use write_bytes for known counts. For v1, document the limitation.
      return { code: `/* i2c.write_buffer(${o.data}): use i2c.write_bytes for explicit byte lists (v1) */` };
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
    case 'i2c.end':
      return { code: `if (__tc_i2c${idx}_bus) { i2c_del_master_bus(__tc_i2c${idx}_bus); __tc_i2c${idx}_bus = NULL; __tc_i2c${idx}_dev = NULL; }` };
    default:
      throw new Error(`framework-esp32 does not yet support HAL op \`${op.operation}\`.`);
  }
}
