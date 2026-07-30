import { describe, it, expect } from 'vitest';

// DAC is unsupported on the nRF52840 (no DAC peripheral). The manifest declares
// dac.unsupported, and lowerHalOp returns undefined for dac.* ops — they never
// reach a lowering fn. This test locks in that contract: the dispatcher must
// NOT route dac.* anywhere (the manifest validator cross-checks the same).
import { lowerHalOp } from '../../../../packages/framework-zephyr/src/lowering/index';
import { setActiveChip } from '../../../../packages/framework-zephyr/src/chips/index';
import { XIAO_BLE } from '../../../../packages/framework-zephyr/src/chips/xiao-ble';

setActiveChip(XIAO_BLE);

describe('dac lowering (unsupported on nRF52840)', () => {
  it('lowerHalOp returns undefined for dac.write (no DAC on this target)', () => {
    expect(lowerHalOp({ operation: 'dac.write', pin: 5, value: 128 } as any))
      .toBeUndefined();
  });
});
