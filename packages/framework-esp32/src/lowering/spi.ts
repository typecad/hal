import type { HALOpIR } from '@typecad/cuttlefish/api/shared';
import { getActiveChip } from '../chips/index.js';
import { parseControllerIndex } from './util.js';

export function spiInitLines(controllerIndex: number): string[] {
  const chip = getActiveChip();
  const cfg = chip.spi.controllers[controllerIndex];
  if (!cfg) throw new Error(`SPI controller ${controllerIndex} not present on ${chip.id}`);
  return [
    `// CUTTLEFISH_SPI_BEGIN`,
    `static spi_device_handle_t __tc_spi${controllerIndex}_dev = NULL;`,
    `static bool __tc_spi${controllerIndex}_bus_ready = false;`,
    `static void __tc_spi${controllerIndex}_init(void) {`,
    `    if (__tc_spi${controllerIndex}_bus_ready) return;`,
    `    const spi_bus_config_t buscfg = {`,
    `        .mosi_io_num = ${cfg.defaultMosi},`,
    `        .miso_io_num = ${cfg.defaultMiso},`,
    `        .sclk_io_num = ${cfg.defaultSclk},`,
    `        .quadwp_io_num = -1,`,
    `        .quadhd_io_num = -1,`,
    `    };`,
    `    spi_bus_initialize(${cfg.host}, &buscfg, SPI_DMA_CH_AUTO);`,
    `    __tc_spi${controllerIndex}_bus_ready = true;`,
    `}`,
    `// CUTTLEFISH_SPI_END`,
    ``,
  ];
}

/** Best-effort parse of an Arduino-style SPISettings(...) expression. */
function parseSpiSettings(settings: unknown): { hz: number; mode: number } {
  const s = String(settings ?? '');
  const m = s.match(/SPISettings\s*\(\s*(\d+)\s*,[^,]*,\s*SPI_MODE(\d)\s*\)/i);
  if (m) {
    return { hz: parseInt(m[1], 10), mode: parseInt(m[2], 10) };
  }
  return { hz: 1000000, mode: 0 };
}

/** Resolve a HAL spi.* op to ESP-IDF C++. */
export function lowerSpi(op: HALOpIR): { code?: string; expression?: string } {
  const o = op as any;
  const idx = parseControllerIndex(o.bus ?? o.port);
  const chip = getActiveChip();
  const cfg = chip.spi.controllers[idx];
  if (!cfg) throw new Error(`SPI ${idx} not present on ${chip.id}`);

  switch (op.operation) {
    case 'spi.begin':
      return { code: `__tc_spi${idx}_init();` };
    case 'spi.begin_transaction': {
      const { hz, mode } = parseSpiSettings(o.settings);
      return { code: [
        `if (!__tc_spi${idx}_dev) {`,
        `    __tc_spi${idx}_init();`,
        `    const spi_device_interface_config_t devcfg = {`,
        `        .clock_speed_hz = ${hz}, .mode = ${mode},`,
        `        .spics_io_num = -1, .queue_size = 4,`,
        `    };`,
        `    spi_bus_add_device(${cfg.host}, &devcfg, &__tc_spi${idx}_dev);`,
        `}`,
      ].join(' ') };
    }
    case 'spi.transfer': {
      const data = o.data;
      return { expression: [
        `({ uint8_t _tx = (${data}); uint8_t _rx = 0;`,
        `   spi_transaction_t _t = { .tx_buffer = &_tx, .rx_buffer = &_rx, .length = 8 };`,
        `   spi_device_polling_transmit(__tc_spi${idx}_dev, &_t); _rx; })`,
      ].join(' ') };
    }
    case 'spi.cs_low':
      return { code: `gpio_set_level((gpio_num_t)${o.pin}, 0);` };
    case 'spi.cs_high':
      return { code: `gpio_set_level((gpio_num_t)${o.pin}, 1);` };
    case 'spi.set_mode':
      return { code: `/* spi.set_mode(${o.mode}): applied at device-add via SPISettings */` };
    case 'spi.set_bit_order':
      return { code: `/* spi.set_bit_order(${o.order}): ESP-IDF master uses MSB */` };
    case 'spi.end_transaction':
      return { code: `` };
    case 'spi.end':
      return { code: `if (__tc_spi${idx}_dev) { spi_bus_remove_device(__tc_spi${idx}_dev); __tc_spi${idx}_dev = NULL; spi_bus_free(${cfg.host}); __tc_spi${idx}_bus_ready = false; }` };
    default:
      throw new Error(`framework-esp32 does not yet support HAL op \`${op.operation}\`.`);
  }
}
