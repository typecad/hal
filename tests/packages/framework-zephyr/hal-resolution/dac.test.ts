import { describe, it, expect } from 'vitest';
import { lowerDac, dacInitLines } from '../../../../packages/framework-zephyr/src/lowering/dac';
import { ESP32_DEVKITC } from '../../../../packages/framework-zephyr/src/chips/esp32';
import { XIAO_BLE } from '../../../../packages/framework-zephyr/src/chips/xiao-ble';

describe('dac init block', () => {
  it('emits the DAC device handle on a chip with a DAC', () => {
    const lines = dacInitLines(ESP32_DEVKITC).join('\n');
    expect(lines).toContain('// CUTTLEFISH_DAC_BEGIN');
    expect(lines).toContain('// CUTTLEFISH_DAC_END');
    expect(lines).toContain('DEVICE_DT_GET(DT_NODELABEL(dac0))');
    expect(lines).toContain('__tc_dac_dev');
  });

  it('emits nothing on a chip without a DAC', () => {
    expect(dacInitLines(XIAO_BLE)).toEqual([]);
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
    const out = lowerDac({ operation: 'dac.write_value', pin: 2, value: 128, resolution: 0 } as any, XIAO_BLE);
    expect(out.code).toContain('no DAC on xiao_ble');
  });
});
