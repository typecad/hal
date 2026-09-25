// ---------------------------------------------------------------------------
// can.test.ts — the CAN bus class (hal/can.ts): unit lowerings (begin order,
// frame build, filter install), the harvested-facts gate, and the
// end-to-end resolver path. Loopback mode makes the hardware side fully
// testable with zero wiring — see tests/board/21-can.test.ts.
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';
import { lowerCan, canInitLines } from '../../../../packages/framework-zephyr/src/lowering/can';

import { transpile, expectCppContains } from '../../../setup';
import { ZephyrStrategy } from '../../../../packages/framework-zephyr/src/strategy';
import { generateBoard } from '../../../../packages/framework-zephyr/src/boardgen';
import type { BoardConstants } from '../../../../packages/cuttlefish/src/api/shared/board-resolver';

const TWAI_CHIP = { can: { controllers: [{ nodeLabel: 'twai', compatible: 'espressif,esp32-twai' }] } } as any;
const NO_CAN = {} as any;

describe('can lowering', () => {
  it('begin applies loopback + bitrate before the once-guarded start', () => {
    const out = lowerCan({ operation: 'can.begin', hz: 250000, loopback: true } as any, TWAI_CHIP);
    expect(out.code).toContain('can_set_mode(__tc_can0_dev, CAN_MODE_LOOPBACK)');
    expect(out.code.indexOf('can_set_mode')).toBeLessThan(out.code.indexOf('can_set_bitrate'));
    expect(out.code.indexOf('can_set_bitrate')).toBeLessThan(out.code.indexOf('can_start'));
    expect(out.code).toContain('can_set_bitrate(__tc_can0_dev, 250000)');
    // The once-flag is shim-scoped (canInitLines emits it), not redeclared
    // per call site — a second begin() anywhere must not re-fire can_start.
    expect(out.code).not.toContain('static bool __tc_can0_started');
    expect(canInitLines(TWAI_CHIP, 0, { begin: true, send: false, onReceive: false })).toEqual(
      expect.arrayContaining(['static bool __tc_can0_started = false;']),
    );
  });

  it('send builds the frame with dlc, payload, and optional IDE flag', () => {
    const out = lowerCan({ operation: 'can.send', id: '0x123', extended: false, data: [0x11, 0x22] } as any, TWAI_CHIP);
    expect(out.code).toContain('__tc_frame.id = static_cast<uint32_t>(0x123)');
    expect(out.code).toContain('__tc_frame.dlc = 2U');
    expect(out.code).toContain('__tc_frame.data[0] = static_cast<uint8_t>(17)');
    expect(out.code).toContain('__tc_frame.flags = 0U');
    expect(out.code).toContain('can_send(__tc_can0_dev, &__tc_frame, K_MSEC(100), __tc_can_tx_done, NULL)');
    const ext = lowerCan({ operation: 'can.send', id: 1, extended: true, data: [] } as any, TWAI_CHIP);
    expect(ext.code).toContain('CAN_FRAME_IDE');
  });

  it('over-8-byte payloads are build errors', () => {
    expect(() => lowerCan({ operation: 'can.send', id: 1, extended: false, data: [1,2,3,4,5,6,7,8,9] } as any, TWAI_CHIP)).toThrow(/8 bytes/);
  });

  it('on_receive installs the handler behind the once-guarded filter', () => {
    const out = lowerCan({ operation: 'can.on_receive', handler: 'onFrame' } as any, TWAI_CHIP);
    expect(out.code).toContain('__tc_can0_rx = onFrame;');
    expect(out.code).toContain('can_add_rx_filter(__tc_can0_dev, __tc_can_rx_trampoline, NULL, &__tc_can0_filter)');
    // A second accept-all filter carries CAN_FILTER_IDE — Zephyr never
    // delivers an extended frame to a filter without it.
    expect(out.code).toContain('can_add_rx_filter(__tc_can0_dev, __tc_can_rx_trampoline, NULL, &__tc_can0_filter_ext)');
  });

  it('boards without a harvested can@ node lower to the honest comment (DAC discipline)', () => {
    const out = lowerCan({ operation: 'can.begin', hz: 500000, loopback: false } as any, NO_CAN);
    expect(out.code).toContain('no CAN controller');
  });
});

describe('can end-to-end (esp32s3 target)', () => {
  it('the loopback round-trip program lowers completely', () => {
    const constants: BoardConstants = new Map(Object.entries(JSON.parse(generateBoard('esp32s3_devkitc/esp32s3/procpu').boardJson).constants));
    const result = transpile(`
      import { CAN } from '@typecad/hal';

      const bus = new CAN(0, { loopback: true });
      bus.begin();
      bus.onReceive((id: number, len: number, b0: number, b1: number, b2: number, b3: number, b4: number, b5: number, b6: number, b7: number): void => {
        const _seen = id;
      });
      bus.send(0x123, [0x11, 0x22]);
    `, {
      strategy: new ZephyrStrategy(),
      target: 'zephyr',
      boardConstants: constants,
      platformContext: { frameworkData: { target: 'esp32s3_devkitc' } } as any,
    });

    expectCppContains(result, [
      'DEVICE_DT_GET(DT_NODELABEL(twai))',
      'can_set_mode(__tc_can0_dev, CAN_MODE_LOOPBACK)',
      '__tc_can0_rx = main_isr_0',
      '__tc_frame.id = static_cast<uint32_t>(291)',
      '__tc_frame.data[1] = static_cast<uint8_t>(34)',
      'can_send(__tc_can0_dev, &__tc_frame, K_MSEC(100), __tc_can_tx_done, NULL)',
    ]);
  });
});
