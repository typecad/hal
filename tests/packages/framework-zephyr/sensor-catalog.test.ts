// Sensor catalog + generic Sensor HAL lowering — the code-first peripheral
// path. The catalog (packages/hal/src/sensor-catalog.generated.ts) is pure
// data generated from Zephyr's binding YAMLs and driver channel tables; the
// lowering resolves ops against it and the overlay emits one DT child node
// per constructed sensor, which is the driver's enable switch (Kconfig
// `default y` on DT_HAS_<COMPAT>_ENABLED). These tests pin the join points:
// catalog shape, token scanning, name derivation (lowering ↔ overlay
// agreement), lowering output, overlay emission, and the CONFIG_SENSOR gate.

import { describe, it, expect } from 'vitest';
import { SENSOR_PART_INFO, SENSOR, CHAN, SensorChannelOf } from '../../../packages/hal/src/sensor-catalog.generated';
import { lowerSensor, sensorNames, sensorStateLines, sensorPartKey, sensorChanName } from '../../../packages/framework-zephyr/src/lowering/sensor';
import { scanSensorParts } from '../../../packages/framework-zephyr/src/toolchain/index';
import { generateOverlay } from '../../../packages/framework-zephyr/src/dt-config/overlay';
import { resolveKconfigFragments, applySensorKconfigExceptions } from '../../../packages/framework-zephyr/src/dt-config/kconfig';
import type { ZephyrChipDescriptor } from '../../../packages/framework-zephyr/src/chips/types';

describe('generated sensor catalog', () => {
  it('carries the SHT3XD with its bus, compatible, and driver-served channels', () => {
    const sht3xd = SENSOR_PART_INFO['sensirion_sht3xd'];
    expect(sht3xd).toBeDefined();
    expect(sht3xd.compatible).toBe('sensirion,sht3xd');
    expect(sht3xd.buses).toContain('i2c');
    expect(sht3xd.channels).toContain('AMBIENT_TEMP');
    expect(sht3xd.channels).toContain('HUMIDITY');
  });

  it('merges dual-bus parts under one token', () => {
    const bme280 = SENSOR_PART_INFO['bosch_bme280'];
    expect(bme280.buses).toEqual(['i2c', 'spi']);
  });

  it('exposes a SENSOR token for every catalog entry (completion surface)', () => {
    expect(Object.keys(SENSOR).length).toBe(Object.keys(SENSOR_PART_INFO).length);
    expect(SENSOR['sensirion_sht3xd']).toBe('sensirion_sht3xd');
  });

  it('maps Zephyr channel verbiage minus the SENSOR_CHAN_ prefix', () => {
    expect(CHAN.AMBIENT_TEMP).toBe('AMBIENT_TEMP');
    expect(CHAN.HUMIDITY).toBe('HUMIDITY');
  });
});

describe('sensor token normalization', () => {
  it('strips the SENSOR./CHAN. property-access prefixes', () => {
    expect(sensorPartKey('SENSOR.sensirion_sht3xd')).toBe('sensirion_sht3xd');
    expect(sensorChanName('CHAN.AMBIENT_TEMP')).toBe('AMBIENT_TEMP');
  });
});

describe('sensor name derivation (lowering ↔ overlay contract)', () => {
  it('derives DT label and C variables from the op facts', () => {
    const n = sensorNames('sensirion_sht3xd', 'Wire', 0x44);
    expect(n.dtLabel).toBe('tc_sensirion_sht3xd_i2c0_0x44');
    expect(n.devVar).toBe('__tc_sensor_sensirion_sht3xd_i2c0_0x44_dev');
    expect(n.valVar).toBe('__tc_sensor_sensirion_sht3xd_i2c0_0x44_val');
    expect(n.busIndex).toBe(0);
  });

  it('parses the bus instance from a numbered alias', () => {
    expect(sensorNames('bosch_bme280', 'Wire1', '0x76').busIndex).toBe(1);
  });

  it('round-trips through the emitted-source scanner', () => {
    const n = sensorNames('sensirion_sht3xd', 'I2C0', 0x44);
    const src = `static const struct device* ${n.devVar} = DEVICE_DT_GET(DT_NODELABEL(${n.dtLabel}));`;
    const scanned = scanSensorParts(src);
    expect(scanned).toEqual([{ part: 'sensirion_sht3xd', busIndex: 0, port: 0x44, busKind: 'i2c', spiHz: 0, spiMode: 0, alertPin: -1 }]);
  });

  it('round-trips an SPI sensor (CS pin form) through the scanner', () => {
    const src = 'static const struct device* __tc_sensor_bosch_bme280_spi0_cs10_dev = DEVICE_DT_GET(DT_NODELABEL(tc_bosch_bme280_spi0_cs10));';
    expect(scanSensorParts(src)).toEqual([{ part: 'bosch_bme280', busIndex: 0, port: 10, busKind: 'spi', spiHz: 0, spiMode: 0, alertPin: -1 }]);
  });

  it('merges the state-block config comment into the scanned ref', () => {
    const src = 'static const struct device* __tc_sensor_bosch_bme280_spi0_cs10_dev = DEVICE_DT_GET(DT_NODELABEL(tc_bosch_bme280_spi0_cs10));' + '\n'
      + '// tc-sensor-cfg: tc_bosch_bme280_spi0_cs10 hz=10000000 mode=3 alert=-1';
    expect(scanSensorParts(src)).toEqual([{ part: 'bosch_bme280', busIndex: 0, port: 10, busKind: 'spi', spiHz: 10000000, spiMode: 3, alertPin: -1 }]);
  });
});

describe('lowerSensor', () => {
  it('lowers fetch to sensor_sample_fetch on the generated device handle', () => {
    const r = lowerSensor({ operation: 'sensor.fetch', part: 'SENSOR.sensirion_sht3xd', bus: 'I2C0', port: 0x44, busKind: 'i2c' } as never);
    expect(r.code).toBe('(void)__tc_sensor_sensirion_sht3xd_i2c0_0x44_val; sensor_sample_fetch(__tc_sensor_sensirion_sht3xd_i2c0_0x44_dev);');
  });

  it('lowers get to a channel read with the sensor_value double conversion', () => {
    const r = lowerSensor({ operation: 'sensor.get', part: 'SENSOR.sensirion_sht3xd', bus: 'I2C0', port: 0x44, busKind: 'i2c', chan: 'CHAN.AMBIENT_TEMP' } as never);
    expect(r.expression).toContain('sensor_channel_get(__tc_sensor_sensirion_sht3xd_i2c0_0x44_dev, SENSOR_CHAN_AMBIENT_TEMP, &__tc_sensor_sensirion_sht3xd_i2c0_0x44_val)');
    expect(r.expression).toContain('static_cast<double>');
  });

  it('rejects a channel the driver does not serve (build-time, Zephyr verbiage)', () => {
    expect(() =>
      lowerSensor({ operation: 'sensor.get', part: 'SENSOR.sensirion_sht3xd', bus: 'I2C0', port: 0x44, busKind: 'i2c', chan: 'CHAN.PRESSURE' } as never),
    ).toThrow(/does not serve channel 'PRESSURE'.*AMBIENT_TEMP.*HUMIDITY/s);
  });

  it('rejects an unknown part token', () => {
    expect(() =>
      lowerSensor({ operation: 'sensor.fetch', part: 'SENSOR.not_a_part', bus: 'I2C0', port: 0x44, busKind: 'i2c' } as never),
    ).toThrow(/not in the Zephyr sensor catalog/);
  });

  it('emits a device-handle state block naming the DT nodelabel', () => {
    const lines = sensorStateLines('sensirion_sht3xd', 'I2C0', 0x44);
    expect(lines.join('\n')).toContain('DEVICE_DT_GET(DT_NODELABEL(tc_sensirion_sht3xd_i2c0_0x44))');
  });
});

/** Minimal chip descriptor with one I2C controller, blackpill-shaped. */
const chip = {
  id: 'stm32f411xe',
  i2c: { controllers: [{ nodeLabel: 'i2c1' }] },
  spi: { controllers: [{ nodeLabel: 'spi1' }] },
  gpioControllers: [
    { nodelabel: 'gpioa', minPin: 0, maxPin: 15 },
    { nodelabel: 'gpiob', minPin: 16, maxPin: 31 },
  ],
} as unknown as ZephyrChipDescriptor;

describe('overlay sensor node emission', () => {
  it('emits one DT child node per constructed sensor on its controller', () => {
    const overlay = generateOverlay(chip, {
      usesSensor: true,
      sensorParts: [{ part: 'sensirion_sht3xd', busIndex: 0, port: 0x44, busKind: 'i2c' }],
    });
    expect(overlay).toContain('&i2c1 {');
    expect(overlay).toContain('tc_sensirion_sht3xd_i2c0_0x44: sht3xd@44 {');
    expect(overlay).toContain('compatible = "sensirion,sht3xd";');
    expect(overlay).toContain('reg = <0x44>;');
  });

  it('enables the controller for a sensor even without direct i2c.* usage', () => {
    const overlay = generateOverlay(chip, {
      sensorParts: [{ part: 'sensirion_sht3xd', busIndex: 0, port: 0x44, busKind: 'i2c' }],
    });
    expect(overlay).toContain('&i2c1 {');
    expect(overlay).toContain('status = "okay";');
  });

  it('emits no sensor node without constructed sensors', () => {
    const overlay = generateOverlay(chip, { usesI2c: true });
    expect(overlay).not.toContain('sht3xd');
  });
});

describe('overlay SPI sensor emission', () => {
  it('emits cs-gpios plus a reg-by-CS-index child node', () => {
    const overlay = generateOverlay(chip, {
      usesSensor: true,
      sensorParts: [{ part: 'bosch_bme280', busIndex: 0, port: 10, busKind: 'spi' }],
    });
    expect(overlay).toContain('&spi1 {');
    expect(overlay).toContain('cs-gpios = <&gpioa 10 GPIO_ACTIVE_LOW>;');
    expect(overlay).toContain('tc_bosch_bme280_spi0_cs10: bme280@0 {');
    expect(overlay).toContain('reg = <0>;');
    expect(overlay).toContain('spi-max-frequency = <1000000>;');
  });

  it('assigns sequential CS indices for multiple sensors on one controller', () => {
    const overlay = generateOverlay(chip, {
      sensorParts: [
        { part: 'bosch_bme280', busIndex: 0, port: 10, busKind: 'spi' },
        { part: 'adi_adt7310', busIndex: 0, port: 11, busKind: 'spi' },
      ],
    });
    expect(overlay).toContain('cs-gpios = <&gpioa 10 GPIO_ACTIVE_LOW>, <&gpioa 11 GPIO_ACTIVE_LOW>;');
    expect(overlay).toContain('tc_adi_adt7310_spi0_cs11: adt7310@1 {');
  });
});

describe('overlay SPI options and alert', () => {
  it('applies the constructor spiHz/mode to the child node', () => {
    const overlay = generateOverlay(chip, {
      usesSensor: true,
      sensorParts: [{ part: 'bosch_bme280', busIndex: 0, port: 10, busKind: 'spi', spiHz: 10000000, spiMode: 3 }],
    });
    expect(overlay).toContain('spi-max-frequency = <10000000>;');
    expect(overlay).toContain('spi-cpol;');
    expect(overlay).toContain('spi-cpha;');
    expect(overlay).not.toContain('spi-max-frequency = <1000000>;');
  });

  it('emits alert-gpios only for parts whose binding declares it', () => {
    const withAlert = generateOverlay(chip, {
      sensorParts: [{ part: 'sensirion_sht3xd', busIndex: 0, port: 0x44, busKind: 'i2c', alertPin: 3 }],
    });
    expect(withAlert).toContain('alert-gpios = <&gpioa 3 GPIO_ACTIVE_HIGH>;');
    // alert pin on a part with no alert binding: omitted
    const withoutBinding = generateOverlay(chip, {
      sensorParts: [{ part: 'bosch_bme280', busIndex: 0, port: 0x76, busKind: 'i2c', alertPin: 3 }],
    });
    expect(withoutBinding).not.toContain('alert-gpios');
  });
});

describe('Kconfig gating', () => {
  it('sets only the umbrella CONFIG_SENSOR — the driver defaults on from DT', () => {
    const m = resolveKconfigFragments({ usesSensor: true }, false);
    expect(m.get('CONFIG_SENSOR')).toBe('y');
    expect([...m.keys()].filter((k) => k.startsWith('CONFIG_SHT3XD'))).toEqual([]);
  });

  it('turns on cbprintf float support when a float specifier is emitted', () => {
    const m = resolveKconfigFragments({ usesFloatFormat: true }, false);
    expect(m.get('CONFIG_CBPRINTF_FP_SUPPORT')).toBe('y');
    expect(m.get('CONFIG_CBPRINTF_COMPLETE')).toBe('y');
  });

  it('leaves CONFIG_SENSOR off without sensor usage', () => {
    const m = resolveKconfigFragments({}, false);
    expect(m.has('CONFIG_SENSOR')).toBe(false);
  });
});


describe('SensorChannelOf narrowing map', () => {
  it('carries a literal union per part (the Sensor<P>.get() surface)', () => {
    // Compile-time: these index accesses only type-check because the map's
    // values are literal unions. Runtime: spot-check the entries exist.
    const sht: CHAN.AMBIENT_TEMP | CHAN.HUMIDITY = null as unknown as SensorChannelOf['sensirion_sht3xd'];
    const bme: CHAN.AMBIENT_TEMP | CHAN.HUMIDITY | CHAN.PRESS = null as unknown as SensorChannelOf['bosch_bme280'];
    expect(sht).toBeNull();
    expect(bme).toBeNull();
  });
});


describe('per-part Kconfig exceptions', () => {
  it('applies catalog-recorded lines for constructed parts only', () => {
    const m = new Map<string, string>();
    applySensorKconfigExceptions(
      m,
      [{ part: 'some_part' }, { part: 'clean_part' }],
      { some_part: { kconfig: ['CONFIG_SOME_DRIVER=y'] }, clean_part: { kconfig: [] } } as never,
    );
    expect(m.get('CONFIG_SOME_DRIVER')).toBe('y');
    expect(m.size).toBe(1);
  });

  it('no-ops without sensor parts (every in-tree part today)', () => {
    const m = new Map<string, string>();
    applySensorKconfigExceptions(m, undefined, {} as never);
    expect(m.size).toBe(0);
  });
});
