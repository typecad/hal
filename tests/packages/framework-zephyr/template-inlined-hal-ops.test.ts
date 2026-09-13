// ---------------------------------------------------------------------------
// Template-inlined HAL ops must still earn their shim state.
//
// A value-returning HAL call interpolated into another HAL call's template
// literal (`USB0.writeLine(\`n: ${gps.available()}\`)`) is lowered to C++ text
// while BUILDING the IR — it never becomes a hal-op/hal-expr IR node, so the
// strategy's per-peripheral scans (which walk the IR for structured ops)
// cannot see it. The ops ride on ProgramIR.resolvedHalOps instead (recorded by
// markHalOpResolved during this file's build); every collector folds them in
// (visitResolvedHalOps) or the state block the baked text references goes
// undeclared — the `'__tc_dt_led0' was not declared in this scope` failure
// class (zephyr-blackpill demo).
//
// One regression per subsystem whose shim is keyed on those scans: the UART
// RX ring + ISR, the per-controller I2C device handle, the per-target SPI
// dt_spec, the per-sensor device handle, and the ADC override device handle.
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';
import { transpileZephyrStrategy } from '../../setup';

describe('template-inlined HAL ops still emit their shim state', () => {
  it('UART.available() inlined into a template declares its RX ring', () => {
    const result = transpileZephyrStrategy(`
      import { UART, USB0 } from '@typecad/hal';
      const gps = new UART('UART0', { baud: 9600, rxBufferBytes: 64 });
      USB0.open();
      USB0.writeLine(\`n: \${gps.available()}\`);
    `);
    // The lowered reference …
    expect(result.cpp).toContain('(__tc_uartrx0_head - __tc_uartrx0_tail)');
    // … and the ring + ISR it needs, sized from the construction.
    expect(result.cpp).toContain('static uint8_t __tc_uartrx0_buf[64];');
    expect(result.cpp).toContain('__tc_uartrx0_isr');
  });

  it('I2CTarget.readReg() inlined into a template declares its controller handle', () => {
    const result = transpileZephyrStrategy(`
      import { I2CTarget, USB0 } from '@typecad/hal';
      const dev = new I2CTarget('I2C0', 0x44);
      USB0.open();
      USB0.writeLine(\`r: \${dev.readReg(0)}\`);
    `);
    expect(result.cpp).toContain('i2c_reg_read_byte(__tc_i2c0_dev');
    expect(result.cpp).toMatch(/static const struct device\* __tc_i2c0_dev/);
  });

  it('SPITarget.readReg() inlined into a template declares its spi_dt_spec', () => {
    const result = transpileZephyrStrategy(`
      import { SPITarget, USB0 } from '@typecad/hal';
      const flash = new SPITarget('SPI0', 10);
      USB0.open();
      USB0.writeLine(\`id: \${flash.readReg(0x9F)}\`);
    `);
    expect(result.cpp).toMatch(/spi_read_dt\(&__tc_spit_spi0_cs10_spec|spi_transceive_dt\(&__tc_spit_spi0_cs10_spec/);
    expect(result.cpp).toContain('static const struct spi_dt_spec __tc_spit_spi0_cs10_spec');
  });

  it('Sensor.get() inlined into a template declares its device handle', () => {
    const result = transpileZephyrStrategy(`
      import { Sensor, SENSOR, CHAN, I2C0, USB0 } from '@typecad/hal';
      const tmp = new Sensor(SENSOR.sensirion_sht3xd, I2C0.device(0x44));
      USB0.open();
      USB0.writeLine(\`t: \${tmp.get(CHAN.AMBIENT_TEMP)}\`);
    `);
    expect(result.cpp).toContain('sensor_channel_get(__tc_sensor_sensirion_sht3xd_i2c0_0x44_dev');
    expect(result.cpp).toMatch(
      /static const struct device\* __tc_sensor_sensirion_sht3xd_i2c0_0x44_dev/,
    );
  });

  it('ADC.read() with a device override inlined into a template declares the override handle', () => {
    const result = transpileZephyrStrategy(`
      import { ADC, USB0 } from '@typecad/hal';
      const sense = new ADC(4, { device: 'adc2', channel: 1 });
      USB0.open();
      USB0.writeLine(\`raw: \${sense.read()}\`);
    `);
    expect(result.cpp).toContain('adc_channel_setup(__tc_adc_adc2_dev');
    expect(result.cpp).toMatch(/static const struct device\* __tc_adc_adc2_dev/);
  });
});
