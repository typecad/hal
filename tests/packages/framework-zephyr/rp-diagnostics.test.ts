// ---------------------------------------------------------------------------
// profileDiagnostics gates exercised through the RP2040/RP2350 board packages
// (the resolveChipFromBoard path — program.boardConstants carries the chip).
//
// Covers the two gates added for the Pico boards:
//   - pwm on a pin with no spec in the chip descriptor (silently lowered to
//     a comment otherwise) → warning, never an error (partial PWM coverage is
//     legitimate; the rest of the program still works)
//   - i2c/spi/uart instance beyond the declared controllers (the lowering
//     emits __tc_<bus>N_dev references with no declaration → link error)
//     → error, mirroring the ADC gate
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';
import { ZephyrStrategy } from '../../../packages/framework-zephyr/src/strategy';
import { generateBoard } from '../../../packages/framework-zephyr/src/boardgen';
import type { BoardConstants } from '../../../packages/cuttlefish/src/api/shared/board-resolver';
function generatedConstants(target: string): BoardConstants {
  const g = generateBoard(target);
  return new Map(Object.entries(JSON.parse(g.boardJson).constants)) as BoardConstants;
}


const rp2040Board = generatedConstants('rpi_pico/rp2040');
const rp2350Board = generatedConstants('rpi_pico2/rp2350a/m33');

/** Wrap HAL ops in the program-IR shape profileDiagnostics walks. */
function programWith(ops: Record<string, unknown>[], boardConstants = rp2040Board) {
  return {
    boardConstants,
    functions: [{
      statements: ops.map((operation) => ({ kind: 'hal-op', operation })),
    }],
  } as any;
}

describe('ZephyrStrategy.profileDiagnostics — PWM gate (RP boards ship no pwm.specs)', () => {
  const s = new ZephyrStrategy();

  it('warns on pwm.set_pulse against an unlisted pin (rpi_pico)', () => {
    const diags = s.profileDiagnostics(programWith([
      { operation: 'pwm.set_pulse', pin: 15, pulse: 1000 },
    ]));
    const d = diags.find((x) => x.code === 'zephyr-pwm-pin-unavailable');
    expect(d).toBeDefined();
    expect(d!.severity).toBe('warning');
    expect(d!.message).toContain('GPIO 15');
  });

  it('warns on pwm.set_pulse for a pin with no PWM spec (GP15 is unpinned)', () => {
    const diags = s.profileDiagnostics(programWith([
      { operation: 'pwm.set_pulse', pin: 15, pulse: 1000 },
    ]));
    expect(diags.some((x) => x.code === 'zephyr-pwm-pin-unavailable' && x.message.includes('15'))).toBe(true);
  });

  it('accepts tone.play now that the Pico carries the GP25 spec (tone rides specs[0])', () => {
    const diags = s.profileDiagnostics(programWith([
      { operation: 'tone.play', pin: 25, frequency: 440 },
    ]));
    expect(diags.some((x) => x.code === 'zephyr-pwm-pin-unavailable')).toBe(false);
  });

  it('does not warn for a spec-listed pin (xiao_ble pwm-led0 on pin 17)', () => {
    const xiaoBoard = generatedConstants('xiao_ble/nrf52840');
    const diags = s.profileDiagnostics(programWith([
      { operation: 'pwm.set_pulse', pin: 17, pulse: 1000 },
    ], xiaoBoard));
    expect(diags.some((x) => x.code === 'zephyr-pwm-pin-unavailable')).toBe(false);
  });
});

describe('ZephyrStrategy.profileDiagnostics — bus instance gate', () => {
  const s = new ZephyrStrategy();

  it('accepts I2C1 on rpi_pico (both i2c0 and i2c1 are declared controllers)', () => {
    const diags = s.profileDiagnostics(programWith([
      { operation: 'i2c.begin', bus: 'I2C1' },
    ]));
    expect(diags.some((x) => x.code === 'zephyr-bus-instance-unavailable')).toBe(false);
  });

  it('errors on SPI2 on rpi_pico (spi0 + spi1 are declared — the silicon has two)', () => {
    const diags = s.profileDiagnostics(programWith([
      { operation: 'spi.begin', bus: 'SPI2' },
    ]));
    const d = diags.find((x) => x.code === 'zephyr-bus-instance-unavailable');
    expect(d).toBeDefined();
    expect(d!.severity).toBe('error');
    expect(d!.message).toContain('SPI2');
  });

  it('errors on UART2 on rpi_pico (only uart0 + the synthesized uart1 are declared)', () => {
    const diags = s.profileDiagnostics(programWith([
      { operation: 'uart.begin', port: 'UART2', baud: 115200 },
    ]));
    expect(diags.some((x) => x.code === 'zephyr-bus-instance-unavailable' && x.message.includes('UART2'))).toBe(true);
  });

  it('accepts UART1 on rpi_pico (the synthesized uart1 controller)', () => {
    const diags = s.profileDiagnostics(programWith([
      { operation: 'uart.begin', port: 'UART1', baud: 115200 },
    ]));
    expect(diags.some((x) => x.code === 'zephyr-bus-instance-unavailable')).toBe(false);
  });

  it('accepts every declared instance on the Pico 2 (i2c0/i2c1/spi0/uart0)', () => {
    const diags = s.profileDiagnostics(programWith([
      { operation: 'i2c.begin', bus: 'I2C0' },
      { operation: 'i2c.write', bus: 'I2C1', data: 1 },
      { operation: 'spi.begin', bus: 'SPI0' },
      { operation: 'uart.begin', port: 'UART0', baud: 115200 },
    ], rp2350Board));
    expect(diags.some((x) => x.code === 'zephyr-bus-instance-unavailable')).toBe(false);
  });
});
