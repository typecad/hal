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

describe('dac lowering (ESP32 — GPIO25/26)', () => {
  it('dac.write on GPIO25 (channel 1) sets up the channel + writes the value', () => {
    const out = lowerDac({ operation: 'dac.write', pin: 25, value: 128 } as any, ESP32_DEVKITC);
    expect(out.code).toContain('dac_channel_setup');
    expect(out.code).toContain('.channel_id = 1');
    expect(out.code).toContain('.resolution = 8');
    expect(out.code).toContain('dac_write_value(__tc_dac_dev, 1, 128)');
  });

  it('dac.write on GPIO26 (channel 2)', () => {
    const out = lowerDac({ operation: 'dac.write', pin: 26, value: 200 } as any, ESP32_DEVKITC);
    expect(out.code).toContain('.channel_id = 2');
    expect(out.code).toContain('dac_write_value(__tc_dac_dev, 2, 200)');
  });

  it('a non-DAC pin on a DAC chip → comment listing the valid pins', () => {
    const out = lowerDac({ operation: 'dac.write', pin: 4, value: 10 } as any, ESP32_DEVKITC);
    expect(out.code).toContain('not a DAC pin');
    expect(out.code).toContain('25');
    expect(out.code).toContain('26');
  });
});

describe('dac lowering (nRF52840 — no DAC)', () => {
  it('lowers to a "no DAC" comment (probe-tolerant; profileDiagnostics flags misuse)', () => {
    const out = lowerDac({ operation: 'dac.write', pin: 25, value: 128 } as any, XIAO_BLE);
    expect(out.code).toContain('no DAC on xiao_ble');
  });
});
