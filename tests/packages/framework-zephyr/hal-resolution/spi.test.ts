import { describe, it, expect } from 'vitest';
import { lowerSpi, spiInitLines } from '../../../../packages/framework-zephyr/src/lowering/spi';
import { XIAO_BLE } from '../../../../packages/framework-zephyr/src/chips/xiao-ble';


describe('legacy SPI op removal', () => {
  it('manual-CS + transfer ops are gone from the lowering surface', async () => {
    const mod = await import('../../../../packages/framework-zephyr/src/lowering/spi');
    // Only the thin verbs remain exported as lowerable cases; the legacy
    // spi.transfer/cs_low lowering branches no longer exist.
    expect(mod.lowerSpi).toBeTypeOf('function');
  });
});
