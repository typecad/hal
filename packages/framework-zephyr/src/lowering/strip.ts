// ---------------------------------------------------------------------------
// Strip lowering — ws2812-spi child node + led_strip_update_rgb
//
// The strip is an spi-device child of one of the board's wired SPI
// controllers (Zephyr's ws2812-spi driver synthesizes the WS2812 waveform
// on the bus's MOSI line — the board-equal form: the strip uses whatever
// pads the board's devicetree routes that SPI to). The shim block declares
// the pixel buffer + device handle; the overlay generator synthesizes the
// DT child node (chain length + tuned frames — see dt-config/overlay.ts).
// set/fill edit the buffer; show() is one led_strip_update_rgb.
// ----------------------------------------------------------------------------

import type { HALOpIR } from '@typecad/cuttlefish/api/shared';
import type { ZephyrChipDescriptor } from '../chips/types.js';
import { parseControllerIndex } from './util.js';

/** The C variable names for a strip on controller index `idx`. */
function stripVars(idx: number): { buf: string; dev: string } {
  return { buf: `__tc_strip${idx}_buf`, dev: `__tc_strip${idx}_dev` };
}

/**
 * Emit the per-strip state. Called from shimLines for each SPI controller
 * the program drives a strip on: one `struct led_rgb` buffer sized by the
 * construction chain length + the DT device handle.
 */
export function stripInitLines(chip: ZephyrChipDescriptor, busIndex: number, count: number): string[] {
  const ctrl = chip.spi?.controllers[busIndex];
  if (!ctrl) return [];
  const { buf, dev } = stripVars(busIndex);
  return [
    '// CUTTLEFISH_STRIP_BEGIN',
    `static struct led_rgb ${buf}[${count}];`,
    `static const struct device* ${dev} = DEVICE_DT_GET(DT_NODELABEL(tc_strip${busIndex}));`,
    '// CUTTLEFISH_STRIP_END',
  ];
}

/**
 * Resolve a HAL strip.* op to Zephyr C++.
 * Returns `{ code }` for statement ops.
 */
export function lowerStrip(
  op: HALOpIR,
  chip: ZephyrChipDescriptor,
): { code?: string; expression?: string } {
  const o = op as any;
  // DAC discipline: a board with no wired SPI (or an out-of-range bus)
  // lowers to a comment naming the constraint — the honest per-board answer
  // (the manifest probe runs boardless; profileDiagnostics flags the usage).
  const idx = parseControllerIndex(typeof o.bus === 'string' ? o.bus : String(o.bus));
  if (!chip.spi || idx >= chip.spi.controllers.length) {
    const wired = chip.spi ? `this board wires ${chip.spi.controllers.length} SPI controller(s)` : 'this board wires no SPI controller';
    return { code: `/* strip on bus ${o.bus}: no such SPI controller — ${wired}; a Strip rides one of the board's SPI buses */` };
  }
  const { buf, dev } = stripVars(idx);
  const count = Number(o.count ?? 1) || 1;

  switch (op.operation) {
    case 'strip.set_pixel': {
      // Buffer assignment — runtime index and channel values splice as C++.
      // The driver applies the strip's color order (GRB mapping) at show.
      return {
        code: `{ uint32_t __tc_strip_i = static_cast<uint32_t>(${o.index}); if (__tc_strip_i < ${count}U) { ${buf}[__tc_strip_i].r = static_cast<uint8_t>(${o.r}); ${buf}[__tc_strip_i].g = static_cast<uint8_t>(${o.g}); ${buf}[__tc_strip_i].b = static_cast<uint8_t>(${o.b}); } }`,
      };
    }
    case 'strip.fill': {
      return {
        code: `{ for (uint32_t __tc_strip_j = 0U; __tc_strip_j < ${count}U; ++__tc_strip_j) { ${buf}[__tc_strip_j].r = static_cast<uint8_t>(${o.r}); ${buf}[__tc_strip_j].g = static_cast<uint8_t>(${o.g}); ${buf}[__tc_strip_j].b = static_cast<uint8_t>(${o.b}); } }`,
      };
    }
    case 'strip.show': {
      return { code: `(void)led_strip_update_rgb(${dev}, ${buf}, ${count}U);` };
    }
    default:
      throw new Error(
        `framework-zephyr does not yet support HAL op \`${op.operation}\`. ` +
          `Open an issue or use rawCpp() to emit it manually.`,
      );
  }
}
