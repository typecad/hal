// ---------------------------------------------------------------------------
// Peripheral capacity derivation — validatePeripherals must accept the
// instances the board's MCU package actually declares. The count comes from
// an explicit `peripherals.<bus>.count` key when present; otherwise it is
// derived from the flattened `peripherals.<bus>.<N>.instance` entries (the
// board-constants merge of the MCU's *_INSTANCES arrays). Boards whose MCU
// declares a second I2C/SPI/UART (RP2040/RP2350, ESP32) accept instance 1;
// the framework decides separately whether it can lower it.
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';
import { validatePeripherals } from '../../../packages/cuttlefish/src/ir/peripheral-validation';
import type { PeripheralUsage } from '../../../packages/cuttlefish/src/ir/peripheral-usage';
import { resolveBoardConstants } from '../../../packages/cuttlefish/src/ir/board-resolver';

function usageWith(instances: { i2c?: number[]; spi?: number[]; uart?: number[] }): PeripheralUsage {
  const u = {
    i2cInstancesUsed: new Set(instances.i2c ?? []),
    spiInstancesUsed: new Set(instances.spi ?? []),
    uartInstancesUsed: new Set(instances.uart ?? []),
  } as unknown as PeripheralUsage;
  return u;
}

describe('validatePeripherals — capacity from declared instances', () => {
  it('accepts I2C1 on the RP2040 board (MCU declares two I2C controllers)', () => {
    const bc = resolveBoardConstants('boards/board-rp2040/src/index.ts');
    const diags = validatePeripherals(usageWith({ i2c: [0, 1] }), bc, 'main.ts');
    expect(diags).toEqual([]);
  });

  it('accepts UART1/SPI1 at the capacity layer (framework-lowering gates them separately)', () => {
    const bc = resolveBoardConstants('boards/board-rp2350/src/index.ts');
    const diags = validatePeripherals(usageWith({ spi: [1], uart: [1] }), bc, 'main.ts');
    expect(diags).toEqual([]);
  });

  it('rejects an instance beyond the declared ones (I2C2 on a 2-controller board)', () => {
    const bc = resolveBoardConstants('boards/board-rp2040/src/index.ts');
    const diags = validatePeripherals(usageWith({ i2c: [2] }), bc, 'main.ts');
    expect(diags.map((d) => d.message)).toContain('I2C2 is not available on RP2040 (Pico). Available: I2C0 through I2C1');
  });

  it('still defaults to 1 when no instance data is present (no board constants)', () => {
    const diags = validatePeripherals(usageWith({ i2c: [1] }), undefined, 'main.ts');
    expect(diags.length).toBe(1);
  });

  it('an explicit peripherals.<bus>.count still wins over the derived count', () => {
    const bc = new Map<string, unknown>([
      ['name', 'Boardy'],
      ['peripherals.i2c.0.instance', 0],
      ['peripherals.i2c.1.instance', 1],
      ['peripherals.i2c.count', 1],
    ]) as never;
    const diags = validatePeripherals(usageWith({ i2c: [1] }), bc, 'main.ts');
    expect(diags.length).toBe(1);
  });
});
