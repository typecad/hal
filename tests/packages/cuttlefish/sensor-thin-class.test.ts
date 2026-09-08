// ---------------------------------------------------------------------------
// sensor-thin-class.test.ts — the Sensor thin-class pipeline end to end:
// construction facts (bus device, opts, field-initializer defaults) must
// reach the method-body inlining so fetch/get resolve into real sensor ops,
// and the sensor shim block must carry the per-sensor device handles.
//
// Regression history: the Sensor class stores its option defaults as
// class-field initializers (`private readonly _spiHz: number = 1000000`),
// which the construction-fact capture never read — `this->_spiHz` leaked
// verbatim into the emitted C++ and every sensor op fell through unresolved.
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';
import { transpile } from '../../setup';
import { generateBoard } from '../../../packages/framework-zephyr/src/boardgen';
import { ZephyrStrategy } from '../../../packages/framework-zephyr/src/strategy';
import type { BoardConstants } from '../../../packages/cuttlefish/src/api/shared/board-resolver';

function gen(target: string): BoardConstants {
  const g = generateBoard(target);
  return new Map(Object.entries(JSON.parse(g.boardJson).constants)) as BoardConstants;
}

const COMMON = {
  strategy: new ZephyrStrategy(),
  target: 'zephyr' as const,
  boardConstants: gen('blackpill_f411ce/stm32f411xe'),
  platformContext: { frameworkData: { target: 'blackpill_f411ce/stm32f411xe' } } as never,
};

describe('Sensor thin class — construction facts reach the lowering', () => {
  it('fetch/get lower to sensor_sample_fetch / sensor_channel_get with DT device handles', () => {
    const result = transpile(`
      import { I2C0 } from '@typecad/hal';
      import { Sensor, SENSOR, CHAN } from '@typecad/hal';
      const sht3x = new Sensor(SENSOR.sensirion_sht3xd, I2C0.device(0x44));
      sht3x.fetch();
      const t = sht3x.get(CHAN.AMBIENT_TEMP);
      void t;
    `, COMMON);
    expect(result.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
    expect(result.cpp).toContain('sensor_sample_fetch(__tc_sensor_sensirion_sht3xd_i2c0_0x44_dev);');
    expect(result.cpp).toContain('sensor_channel_get(__tc_sensor_sensirion_sht3xd_i2c0_0x44_dev, SENSOR_CHAN_AMBIENT_TEMP');
    // The shim block carries the device handle + value scratch for the
    // constructed sensor (the state block, not an empty marker pair).
    expect(result.cpp).toContain(
      'static const struct device* __tc_sensor_sensirion_sht3xd_i2c0_0x44_dev = DEVICE_DT_GET(DT_NODELABEL(tc_sensirion_sht3xd_i2c0_0x44));',
    );
    // The regression: no raw `this->` may leak into the emitted C++.
    expect(result.cpp).not.toContain('this->_');
    expect(result.cpp).not.toContain('sensorGet(');
    expect(result.cpp).not.toContain('sensorFetch(');
  });

  it('SPI construction + opts resolve with the CS-pin DT naming', () => {
    const result = transpile(`
      import { SPI0 } from '@typecad/hal';
      import { Sensor, SENSOR, CHAN } from '@typecad/hal';
      const bme = new Sensor(SENSOR.bosch_bme280, SPI0.device(4), { spiHz: 10000000 });
      bme.fetch();
      const p = bme.get(CHAN.PRESS);
      void p;
    `, COMMON);
    expect(result.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
    expect(result.cpp).toContain('sensor_sample_fetch(__tc_sensor_bosch_bme280_spi0_cs4_dev);');
    expect(result.cpp).toContain('SENSOR_CHAN_PRESS');
  });

  it('template literals interpolate sensor doubles as %g and escape literal %', () => {
    const result = transpile(`
      import { I2C0 } from '@typecad/hal';
      import { Sensor, SENSOR, CHAN } from '@typecad/hal';
      const s = new Sensor(SENSOR.sensirion_sht3xd, I2C0.device(0x44));
      s.fetch();
      const t = s.get(CHAN.AMBIENT_TEMP);
      const line: string = \`temp: \${t} %RH\`;
      void t;
    `, COMMON);
    // %RH is literal text — must arrive escaped, and the double must take
    // %g (a bare % in the format starts a conversion the compiler rejects).
    expect(result.cpp).toContain('%%RH');
    expect(result.cpp).not.toMatch(/"[^"]*%d[^"]*t\b/);
    // %.15g on the console path (precision-carrying), %g on the HAL-op
    // path — both format doubles correctly.
    expect(result.cpp).toMatch(/%\d*\.?\d*g[^"]*"\s*,\s*t/);
  });

  it('sensor.get results interpolate through a captured variable as %g', () => {
    const result = transpile(`
      import { I2C0 } from '@typecad/hal';
      import { Sensor, SENSOR, CHAN } from '@typecad/hal';
      const s = new Sensor(SENSOR.sensirion_sht3xd, I2C0.device(0x44));
      s.fetch();
      const tenths: number = s.get(CHAN.AMBIENT_TEMP) * 10;
      const line: string = \`t10=\${tenths / 10}\`;
    `, COMMON);
    expect(result.cpp).toMatch(/%\d*\.?\d*g[^"]*"\s*,\s*tenths/);
  });
});
