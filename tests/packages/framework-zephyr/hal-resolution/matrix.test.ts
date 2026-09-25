// ---------------------------------------------------------------------------
// matrix.test.ts — GPIO key-matrix scanning (hal/matrix.ts): the input-event
// trampoline, the construction pad lists' ride onto the op, the overlay's
// gpio-kbd-matrix node, and the end-to-end resolver path.
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';
import { ESP32S3_DEVKITC } from '../helpers/test-chip';
import { lowerMatrix } from '../../../../packages/framework-zephyr/src/lowering/matrix';
import { generateOverlay } from '../../../../packages/framework-zephyr/src/dt-config/overlay';

import { transpile, expectCppContains } from '../../../setup';
import { ZephyrStrategy } from '../../../../packages/framework-zephyr/src/strategy';
import { generateBoard } from '../../../../packages/framework-zephyr/src/boardgen';
import type { BoardConstants } from '../../../../packages/cuttlefish/src/api/shared/board-resolver';

describe('matrix lowering', () => {
  it('on_key carries the pad lists as the overlay marker and assigns the handler', () => {
    const out = lowerMatrix({ operation: 'matrix.on_key', rows: '0,1', cols: '4,5,6', handler: 'onKey' } as any);
    expect(out.code).toContain('/* cuttlefish-matrix: rows=0,1 cols=4,5,6 */');
    expect(out.code).toContain('__tc_matrix_on_key = onKey;');
  });

  it('the overlay synthesizes the gpio-kbd-matrix node with per-controller gpios', () => {
    // The ESP32S3_DEVKITC fixture declares a single gpio0 controller (no
    // split table), so every pad maps to gpio0 with its global number; the
    // split-table arithmetic itself is covered by the gpio lowering tests.
    const overlay = generateOverlay(ESP32S3_DEVKITC, {
      usesMatrix: true,
      matrix: { rows: [1, 2], cols: [4, 35, 36] },
    } as any, undefined);
    expect(overlay).toContain('compatible = "gpio-kbd-matrix";');
    expect(overlay).toContain('row-gpios = <&gpio0 1 (GPIO_PULL_UP | GPIO_ACTIVE_LOW)>, <&gpio0 2 (GPIO_PULL_UP | GPIO_ACTIVE_LOW)>;');
    expect(overlay).toContain('col-gpios = <&gpio0 4 (GPIO_PULL_UP | GPIO_ACTIVE_LOW)>, <&gpio0 35 (GPIO_PULL_UP | GPIO_ACTIVE_LOW)>, <&gpio0 36 (GPIO_PULL_UP | GPIO_ACTIVE_LOW)>;');
  });
});

describe('matrix end-to-end (esp32s3 target)', () => {
  it('construction captures the pad lists; on_key registers the trampoline', () => {
    const constants: BoardConstants = new Map(Object.entries(JSON.parse(generateBoard('esp32s3_devkitc/esp32s3/procpu').boardJson).constants));
    const result = transpile(`
      import { Matrix } from '@typecad/hal';

      const kbd = new Matrix({ rows: [1, 2], cols: [4, 5] });
      kbd.onKey((row: number, col: number, pressed: boolean): void => {
        const _log = 'key';
      });
    `, {
      strategy: new ZephyrStrategy(),
      target: 'zephyr',
      boardConstants: constants,
      platformContext: { frameworkData: { target: 'esp32s3_devkitc' } } as any,
    });

    expectCppContains(result, [
      'static void (*__tc_matrix_on_key)(double, double, bool) = NULL;',
      'case INPUT_ABS_X:',
      'case INPUT_ABS_Y:',
      'case INPUT_BTN_TOUCH:',
      'INPUT_CALLBACK_DEFINE(DEVICE_DT_GET(DT_NODELABEL(tc_matrix)), __tc_matrix_cb, NULL);',
      '__tc_matrix_on_key = ',
      '/* cuttlefish-matrix: rows=1,2 cols=4,5 */',
    ]);
  });
});
