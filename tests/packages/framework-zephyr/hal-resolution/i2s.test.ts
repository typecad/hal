// ---------------------------------------------------------------------------
// i2s.test.ts — the I2S audio class (hal/i2s.ts): unit lowerings and the
// end-to-end resolver path. Hardware loopback verification lives in
// tests/common/22-i2s.test.ts (one jumper O_SD→I_SD; bringup in progress).
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';
import { lowerI2s, i2sInitLines } from '../../../../packages/framework-zephyr/src/lowering/i2s';

import { transpile, expectCppContains } from '../../../setup';
import { ZephyrStrategy } from '../../../../packages/framework-zephyr/src/strategy';
import { generateBoard } from '../../../../packages/framework-zephyr/src/boardgen';
import type { BoardConstants } from '../../../../packages/cuttlefish/src/api/shared/board-resolver';

const I2S_CHIP = { i2s: { controllers: [{ nodeLabel: 'i2s0', compatible: 'espressif,esp32-i2s' }] } } as any;
const NO_I2S = {} as any;

describe('i2s lowering', () => {
  it('the shim block carries the device handle + slabs + combined init', () => {
    const lines = i2sInitLines(I2S_CHIP, 0, 256, { write: true, read: true, readAt: true });
    expect(lines.join('\n')).toContain('DEVICE_DT_GET(DT_NODELABEL(i2s0))');
    expect(lines.join('\n')).toContain('K_MEM_SLAB_DEFINE_STATIC(__tc_i2s0_slab, 256, 2, 4)');
    expect(lines.join('\n')).toContain('K_MEM_SLAB_DEFINE_STATIC(__tc_i2s0_rxslab, 256, 2, 4)');
    expect(lines.join('\n')).toContain('i2s_configure(__tc_i2s0_dev, I2S_DIR_TX');
    expect(lines.join('\n')).toContain('i2s_configure(__tc_i2s0_dev, I2S_DIR_RX');
  });

  it('state gates on verb usage — a write-only program carries no rx buffer', () => {
    const writeOnly = i2sInitLines(I2S_CHIP, 0, 256, { write: true, read: false, readAt: false }).join('\n');
    expect(writeOnly).toContain('__tc_i2s0_txbuf');
    expect(writeOnly).not.toContain('__tc_i2s0_rxbuf');
    const readOnly = i2sInitLines(I2S_CHIP, 0, 256, { write: false, read: true, readAt: true }).join('\n');
    expect(readOnly).toContain('__tc_i2s0_rxbuf');
    expect(readOnly).not.toContain('__tc_i2s0_txbuf');
  });

  it('the once-flags live at shim scope, not in the lowered call sites', () => {
    const lines = i2sInitLines(I2S_CHIP, 0, 256, { write: true, read: true, readAt: false }).join('\n');
    expect(lines).toContain('static bool __tc_i2s0_init_done = false;');
    expect(lines).toContain('static bool __tc_i2s0_tx_started = false;');
    expect(lines).toContain('static bool __tc_i2s0_rx_started = false;');
    const w = lowerI2s({ operation: 'i2s.write', instance: 0, hz: 16000, channels: 2, bits: 16, blockFrames: 16, samples: [1] } as any, I2S_CHIP);
    expect(w.code).not.toContain('static bool __tc_i2s0_init_done');
  });

  it('write packs samples into the block buffer and starts TX after queueing', () => {
    const out = lowerI2s({ operation: 'i2s.write', instance: 0, hz: 16000, channels: 2, bits: 16, blockFrames: 16, samples: [1000, -1000] } as any, I2S_CHIP);
    expect(out.code).toContain('__tc_i2s0_txbuf[0] = static_cast<int16_t>(1000)');
    expect(out.code).toContain('__tc_i2s0_txbuf[1] = static_cast<int16_t>(-1000)');
    expect(out.code).toContain('i2s_buf_write(__tc_i2s0_dev, __tc_i2s0_txbuf, 64U)');
    expect(out.code).toContain('i2s_trigger(__tc_i2s0_dev, I2S_DIR_TX, I2S_TRIGGER_START)');
  });

  it('read starts RX (lazily) and returns the first sample', () => {
    const out = lowerI2s({ operation: 'i2s.read', instance: 0, hz: 16000, channels: 2, bits: 16, blockFrames: 16 } as any, I2S_CHIP);
    expect(out.expression).toContain('i2s_trigger(__tc_i2s0_dev, I2S_DIR_RX, I2S_TRIGGER_START)');
    expect(out.expression).toContain('i2s_buf_read(__tc_i2s0_dev, __tc_i2s0_rxbuf, &got)');
  });

  it('over-block writes are build errors', () => {
    expect(() => lowerI2s({ operation: 'i2s.write', instance: 0, hz: 16000, channels: 2, bits: 16, blockFrames: 4, samples: [1,2,3,4,5,5,6,7,8,9] } as any, I2S_CHIP)).toThrow(/at most 8/);
  });

  it('boards without i2s lower to the honest comment (DAC discipline)', () => {
    const out = lowerI2s({ operation: 'i2s.write', instance: 0, hz: 16000, channels: 2, bits: 16, blockFrames: 64, samples: [1] } as any, NO_I2S);
    expect(out.code).toContain('no I2S controller');
  });
});

describe('i2s end-to-end (esp32s3 target)', () => {
  it('the write/read/readAt program lowers completely', () => {
    const constants: BoardConstants = new Map(Object.entries(JSON.parse(generateBoard('esp32s3_devkitc/esp32s3/procpu').boardJson).constants));
    const result = transpile(`
      import { I2S } from '@typecad/hal';

      const audio = new I2S(0, { hz: 16000 });
      audio.write([1000, -1000]);
      const first = audio.read();
      const second = audio.readAt(1);
    `, {
      strategy: new ZephyrStrategy(),
      target: 'zephyr',
      boardConstants: constants,
      platformContext: { frameworkData: { target: 'esp32s3_devkitc' } } as any,
    });

    expectCppContains(result, [
      'DEVICE_DT_GET(DT_NODELABEL(i2s0))',
      'i2s_buf_write(__tc_i2s0_dev, __tc_i2s0_txbuf',
      'i2s_trigger(__tc_i2s0_dev, I2S_DIR_TX',
      'i2s_buf_read(__tc_i2s0_dev, __tc_i2s0_rxbuf',
      '__tc_i2s0_rxbuf[at]',
    ]);
  });
});
