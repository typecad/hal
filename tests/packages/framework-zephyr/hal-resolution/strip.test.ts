// ---------------------------------------------------------------------------
// strip.test.ts — the addressable LED strip class (hal/strip.ts): unit
// lowerings, the end-to-end resolver path, and the overlay's ws2812-spi
// child-node synthesis. The strip rides one of the board's wired SPI buses
// (Zephyr's ws2812-spi driver synthesizes the waveform on MOSI), so the
// bus instance + chain length are the construction facts.
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';
import { ESP32S3_DEVKITC } from '../helpers/test-chip';
import { lowerStrip } from '../../../../packages/framework-zephyr/src/lowering/strip';
import { generateOverlay } from '../../../../packages/framework-zephyr/src/dt-config/overlay';

import { transpile, expectCppContains } from '../../../setup';
import { ZephyrStrategy } from '../../../../packages/framework-zephyr/src/strategy';
import { generateBoard } from '../../../../packages/framework-zephyr/src/boardgen';
import type { BoardConstants } from '../../../../packages/cuttlefish/src/api/shared/board-resolver';

describe('strip lowering', () => {
  it('set_pixel guards the index against the chain length and assigns the buffer', () => {
    const out = lowerStrip({ operation: 'strip.set_pixel', bus: 'SPI0', count: 8, index: 'i', r: 'rr', g: 'gg', b: 'bb' } as any, ESP32S3_DEVKITC);
    expect(out.code).toContain('__tc_strip_i = static_cast<uint32_t>(i)');
    expect(out.code).toContain('if (__tc_strip_i < 8U)');
    expect(out.code).toContain('__tc_strip0_buf[__tc_strip_i].r = static_cast<uint8_t>(rr)');
    expect(out.code).toContain('__tc_strip0_buf[__tc_strip_i].g = static_cast<uint8_t>(gg)');
    expect(out.code).toContain('__tc_strip0_buf[__tc_strip_i].b = static_cast<uint8_t>(bb)');
  });

  it('fill loops the chain, show is one led_strip_update_rgb', () => {
    const fill = lowerStrip({ operation: 'strip.fill', bus: 'SPI0', count: 30, r: 255, g: 0, b: 0 } as any, ESP32S3_DEVKITC);
    expect(fill.code).toContain('for (uint32_t __tc_strip_j = 0U; __tc_strip_j < 30U; ++__tc_strip_j)');
    expect(fill.code).toContain('__tc_strip0_buf[__tc_strip_j].r = static_cast<uint8_t>(255)');
    const show = lowerStrip({ operation: 'strip.show', bus: 'SPI0', count: 30 } as any, ESP32S3_DEVKITC);
    expect(show.code).toBe('(void)led_strip_update_rgb(__tc_strip0_dev, __tc_strip0_buf, 30U);');
  });

  it('the overlay synthesizes one ws2812-spi child per driven controller', () => {
    const overlay = generateOverlay(ESP32S3_DEVKITC, {
      usesStrip: true,
      strips: [{ index: 0, count: 30 }],
    } as any, undefined);
    expect(overlay).toContain('#include <zephyr/dt-bindings/led/led.h>');
    expect(overlay).toContain('tc_strip0: ws2812@0 {');
    expect(overlay).toContain('compatible = "worldsemi,ws2812-spi";');
    expect(overlay).toContain('chain-length = <30>;');
    expect(overlay).toContain('spi-one-frame = <0xf0>;');
    expect(overlay).toContain('color-mapping = <LED_COLOR_ID_GREEN LED_COLOR_ID_RED LED_COLOR_ID_BLUE>;');
    expect(overlay).toContain('line-idle-low;');
  });
});

describe('strip end-to-end (esp32s3 target)', () => {
  it('construction facts flow through the resolver into buffer C++', () => {
    const constants: BoardConstants = new Map(Object.entries(JSON.parse(generateBoard('esp32s3_devkitc/esp32s3/procpu').boardJson).constants));
    const result = transpile(`
      import { Strip, GPIO } from '@typecad/hal';

      const strip = new Strip(SPI0, { count: 8 });
      strip.set(0, 255, 0, 0);
      strip.fill(0, 255, 0);
      strip.clear();
      strip.show();
    `, {
      strategy: new ZephyrStrategy(),
      target: 'zephyr',
      boardConstants: constants,
      platformContext: { frameworkData: { target: 'esp32s3_devkitc' } } as any,
    });

    expectCppContains(result, [
      'struct led_rgb __tc_strip0_buf[8]',
      'DEVICE_DT_GET(DT_NODELABEL(tc_strip0))',
      '__tc_strip0_buf[__tc_strip_i].r = static_cast<uint8_t>(255)',
      'led_strip_update_rgb(__tc_strip0_dev, __tc_strip0_buf, 8U)',
      // clear() lowers to a zero fill.
      '__tc_strip0_buf[__tc_strip_j].r = static_cast<uint8_t>(0)',
    ]);
  });
});
