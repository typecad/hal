import { describe, it, expect } from 'vitest';
import { TEST_CHIP, chipForBoard } from '../helpers/test-chip';
import { lowerDac, dacInitLines } from '../../../../packages/framework-zephyr/src/lowering/dac';
// Synthetic silicon (DAC channels never live in devicetree): the ESP32's
// DAC1/DAC2 sit on GPIO25/GPIO26.
const ESP32_DEVKITC = {
  ...chipForBoard('esp32_devkitc/esp32/procpu'),
  dac: {
    device: 'dac0',
    channels: [{ pin: 25, channel: 1 }, { pin: 26, channel: 2 }],
  },
};
// The no-DAC counterpart must actually lack the block.
const NO_DAC = { ...TEST_CHIP, dac: undefined };


describe('dac init block', () => {
  it('emits the DAC device handle on a chip with a DAC', () => {
    const lines = dacInitLines(ESP32_DEVKITC).join('\n');
    expect(lines).toContain('// CUTTLEFISH_DAC_BEGIN');
    expect(lines).toContain('// CUTTLEFISH_DAC_END');
    expect(lines).toContain('DEVICE_DT_GET(DT_NODELABEL(dac0))');
    expect(lines).toContain('__tc_dac_dev');
  });

  it('emits nothing on a chip without a DAC', () => {
    expect(dacInitLines(NO_DAC)).toEqual([]);
  });
});

describe('dac lowering (thin write_value)', () => {
  it('write_value on GPIO25 lazily sets up channel 1 and writes the raw code', () => {
    const out = lowerDac({ operation: 'dac.write_value', pin: 25, value: 128, resolution: 0 } as any, ESP32_DEVKITC);
    expect(out.code).toContain('__tc_dact25_done');
    expect(out.code).toContain('.channel_id = 1');
    expect(out.code).toContain('dac_write_value(__tc_dac_dev, 1, 128)');
  });

  it('non-DAC targets lower to a comment for the probe', () => {
    const out = lowerDac({ operation: 'dac.write_value', pin: 2, value: 128, resolution: 0 } as any, NO_DAC);
    expect(out.code).toContain('no DAC on');
  });
});
