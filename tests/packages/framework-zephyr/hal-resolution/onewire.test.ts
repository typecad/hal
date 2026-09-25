// ---------------------------------------------------------------------------
// onewire.test.ts — 1-Wire sensors through the Sensor class (DS18B20): the
// w1 construction form (data-line Pin), the overlay's w1-gpio master +
// family-coded child, and the end-to-end resolver path. The catalog gained
// the w1 bus when the generator learned w1-slave.yaml.
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';
import { sensorNames, sensorStateLines } from '../../../../packages/framework-zephyr/src/lowering/sensor';
import { generateOverlay } from '../../../../packages/framework-zephyr/src/dt-config/overlay';
import { ESP32S3_DEVKITC } from '../helpers/test-chip';

import { transpile, expectCppContains } from '../../../setup';
import { ZephyrStrategy } from '../../../../packages/framework-zephyr/src/strategy';
import { generateBoard } from '../../../../packages/framework-zephyr/src/boardgen';
import type { BoardConstants } from '../../../../packages/cuttlefish/src/api/shared/board-resolver';

describe('onewire sensor names/state', () => {
  it('the w1 stem carries the data pin', () => {
    const n = sensorNames('SENSOR.maxim_ds18b20', '4', 4, 'w1');
    expect(n.dtLabel).toBe('tc_maxim_ds18b20_w1_p4');
    expect(n.devVar).toBe('__tc_sensor_maxim_ds18b20_w1_p4_dev');
    expect(n.busKind).toBe('w1');
  });

  it('the state block carries the resolution for the overlay scanner', () => {
    const lines = sensorStateLines('SENSOR.maxim_ds18b20', '4', 4, 'w1', 0, 0, -1, 10);
    expect(lines.join('\n')).toContain('DEVICE_DT_GET(DT_NODELABEL(tc_maxim_ds18b20_w1_p4))');
    expect(lines.join('\n')).toContain('tc-sensor-cfg: tc_maxim_ds18b20_w1_p4 res=10');
  });
});

describe('onewire overlay synthesis', () => {
  it('emits the w1-gpio master and family-coded child node', () => {
    const overlay = generateOverlay(ESP32S3_DEVKITC, {
      usesSensor: true,
      sensorParts: [{ part: 'maxim_ds18b20', busIndex: 0, port: 4, busKind: 'w1', spiHz: 0, spiMode: 0, alertPin: -1, resolution: 11 }],
    } as any, undefined);
    expect(overlay).toContain('tc_w1_p4: tc-w1-p4 {');
    expect(overlay).toContain('compatible = "zephyr,w1-gpio";');
    expect(overlay).toContain('gpios = <&gpio0 4 (GPIO_OPEN_DRAIN | GPIO_PULL_UP)>;');
    expect(overlay).toContain('compatible = "maxim,ds18b20";');
    expect(overlay).toContain('family-code = <0x28>;');
    expect(overlay).toContain('resolution = <11>;');
    expect(overlay).toContain('tc_maxim_ds18b20_w1_p4: ds18b20 {');
  });
});

describe('onewire end-to-end (esp32s3 target)', () => {
  it('constructing on a Pin lowers to the w1 device handle', () => {
    const constants: BoardConstants = new Map(Object.entries(JSON.parse(generateBoard('esp32s3_devkitc/esp32s3/procpu').boardJson).constants));
    // Numeric pin (harness limitation: string-source transpile cannot
    // resolve board-module pin identifiers — real projects pass GPIO4).
    const result = transpile(`
      import { SENSOR, CHAN, Sensor } from '@typecad/hal';

      const probe = new Sensor(SENSOR.maxim_ds18b20, 4, { resolution: 10 });
      probe.fetch();
      const t = probe.get(CHAN.AMBIENT_TEMP);
    `, {
      strategy: new ZephyrStrategy(),
      target: 'zephyr',
      boardConstants: constants,
      platformContext: { frameworkData: { target: 'esp32s3_devkitc' } } as any,
    });

    expectCppContains(result, [
      'static const struct device* __tc_sensor_maxim_ds18b20_w1_p4_dev = DEVICE_DT_GET(DT_NODELABEL(tc_maxim_ds18b20_w1_p4));',
      'tc-sensor-cfg: tc_maxim_ds18b20_w1_p4 res=10',
      'sensor_sample_fetch(__tc_sensor_maxim_ds18b20_w1_p4_dev)',
      'SENSOR_CHAN_AMBIENT_TEMP',
    ]);
  });
});
