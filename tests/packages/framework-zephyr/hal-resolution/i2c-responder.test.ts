// ---------------------------------------------------------------------------
// i2c-responder.test.ts — the I2C target-mode class (hal/i2c-responder.ts):
// unit lowerings (registration guard, callback install, ring arithmetic,
// response fill), the shim state block, and the end-to-end resolver path.
// The mirror of can.test.ts's shape: the once-guarded registration is the
// filter-install pattern, the trampolined callbacks the rx trampoline.
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';
import { TEST_CHIP } from '../helpers/test-chip';
import { lowerI2c, i2cResponderStateLines } from '../../../../packages/framework-zephyr/src/lowering/i2c';

import { transpile, expectCppContains } from '../../../setup';
import { ZephyrStrategy } from '../../../../packages/framework-zephyr/src/strategy';
import { generateBoard } from '../../../../packages/framework-zephyr/src/boardgen';
import type { BoardConstants } from '../../../../packages/cuttlefish/src/api/shared/board-resolver';
import { ComplianceContext } from '../../../../packages/cuttlefish/src/emit/compliance/compliance-context';
import { runSelfCheck } from '../../../../packages/cuttlefish/src/emit/compliance/rule-engine';

// TEST_CHIP is xiao_ble/nrf52840 — controller 0 is nodeLabel 'i2c1', so the
// responder on I2C0 lowers against __tc_i2c0_dev (the controller INDEX, not
// the nodelabel, names the prefix).

describe('i2c responder state block', () => {
  it('emits the i2c_target vocabulary: five callbacks, config, once-flag', () => {
    const lines = i2cResponderStateLines(TEST_CHIP, 0, 0x42, 64, 32).join('|');
    expect(lines).toContain('static uint8_t __tc_i2cresp0_a42_rx[64]');
    expect(lines).toContain('static uint8_t __tc_i2cresp0_a42_tx[32]');
    // The five driver callbacks, named as Zephyr's struct fields expect them.
    expect(lines).toContain('.write_requested = __tc_i2cresp0_a42_write_requested');
    expect(lines).toContain('.read_requested = __tc_i2cresp0_a42_read_requested');
    expect(lines).toContain('.write_received = __tc_i2cresp0_a42_write_received');
    expect(lines).toContain('.read_processed = __tc_i2cresp0_a42_read_processed');
    expect(lines).toContain('.stop = __tc_i2cresp0_a42_stop');
    // The config carries the address the ops' registration installs.
    expect(lines).toContain('.address = 66U');
    expect(lines).toContain('static bool __tc_i2cresp0_a42_registered = false');
    // The receive ring drops on overflow (the UART discipline), and the
    // stop callback announces the byte count as a double (the callback ABI).
    expect(lines).toContain('__tc_i2cresp0_a42_rx[__tc_i2cresp0_a42_head % 64U] = val');
    expect(lines).toContain('__tc_i2cresp0_a42_on_rx(static_cast<double>(__tc_i2cresp0_a42_head - __tc_i2cresp0_a42_tail))');
  });

  it('a board with no I2C controller emits no state (empty honest answer)', () => {
    expect(i2cResponderStateLines({} as any, 0, 0x42, 64, 32)).toEqual([]);
  });
});

describe('i2c responder lowering (resp_* ops)', () => {
  it('on_receive installs the handler behind the once-guarded registration', () => {
    const out = lowerI2c({ operation: 'i2c.resp_on_receive', bus: 'I2C0', address: 0x42, rx: 64, tx: 32, handler: 'onWrite' } as any, TEST_CHIP);
    expect(out.code).toContain('if (!__tc_i2cresp0_a42_registered)');
    expect(out.code).toContain('i2c_target_register(__tc_i2c0_dev, &__tc_i2cresp0_a42_cfg)');
    // A failed registration prints loudly (a driver with no target mode
    // returns -ENOSYS — never a silent empty responder).
    expect(out.code).toContain('printk("typecad-hal i2c responder: target_register failed: %d\\n"');
    expect(out.code).toContain('__tc_i2cresp0_a42_on_rx = onWrite;');
  });

  it('on_request installs its handler behind the same registration', () => {
    const out = lowerI2c({ operation: 'i2c.resp_on_request', bus: 'I2C0', address: 0x42, rx: 64, tx: 32, handler: 'onRead' } as any, TEST_CHIP);
    expect(out.code).toContain('__tc_i2cresp0_a42_on_rq = onRead;');
  });

  it('available/read are pure ring arithmetic behind the registration arm', () => {
    const avail = lowerI2c({ operation: 'i2c.resp_available', bus: 'I2C0', address: 0x42, rx: 64, tx: 32 } as any, TEST_CHIP);
    expect(avail.expression).toContain('(__tc_i2cresp0_a42_head - __tc_i2cresp0_a42_tail)');
    const read = lowerI2c({ operation: 'i2c.resp_read', bus: 'I2C0', address: 0x42, rx: 64, tx: 32 } as any, TEST_CHIP);
    expect(read.expression).toContain('__tc_i2cresp0_a42_rx[(__tc_i2cresp0_a42_tail)++ % 64U]');
    expect(read.expression).toContain(': -1');
  });

  it('write fills the response buffer, length landing last (no torn read)', () => {
    const out = lowerI2c({ operation: 'i2c.resp_write', bus: 'I2C0', address: 0x42, rx: 64, tx: 32, bytes: [0x2C, 0x06] } as any, TEST_CHIP);
    expect(out.code).toContain('__tc_i2cresp0_a42_tx[0] = static_cast<uint8_t>(44)');
    expect(out.code).toContain('__tc_i2cresp0_a42_tx[1] = static_cast<uint8_t>(6)');
    expect(out.code.indexOf('__tc_i2cresp0_a42_tx[1]')).toBeLessThan(out.code.lastIndexOf('__tc_i2cresp0_a42_txlen = 2U'));
    expect(out.code.indexOf('__tc_i2cresp0_a42_txlen = 0U')).toBeLessThan(out.code.indexOf('__tc_i2cresp0_a42_tx[0]'));
  });

  it('write past the constructed tx size is a build error', () => {
    expect(() =>
      lowerI2c({ operation: 'i2c.resp_write', bus: 'I2C0', address: 0x42, rx: 64, tx: 4, bytes: [1, 2, 3, 4, 5] } as any, TEST_CHIP),
    ).toThrow(/response buffer holds 4 bytes/);
  });

  it('write of a named user buffer copies its storage, clamped', () => {
    const out = lowerI2c({ operation: 'i2c.resp_write', bus: 'I2C0', address: 0x42, rx: 64, tx: 32, bytes: ['page'] } as any, TEST_CHIP);
    expect(out.code).toContain('(__tc_i < sizeof(page)) && (__tc_i < 32U)');
    expect(out.code).toContain('__tc_i2cresp0_a42_tx[__tc_i] = page[__tc_i];');
  });
});

describe('i2c responder end-to-end (xiao_ble target)', () => {
  it('the responder program lowers completely — state, registration, handler', () => {
    const constants: BoardConstants = new Map(Object.entries(JSON.parse(generateBoard('xiao_ble/nrf52840').boardJson).constants));
    const result = transpile(`
      import { I2CResponder } from '@typecad/hal';

      const link = new I2CResponder('I2C0', 0x42, { rxBufferBytes: 48, txBufferBytes: 24 });
      link.onReceive((len: number): void => {
        const _n = len;
      });
      link.onRequest((): void => {
        link.write([0x01, 0x02, 0x03]);
      });
      const waiting = link.available();
      const first = link.read();
    `, {
      strategy: new ZephyrStrategy(),
      target: 'zephyr',
      boardConstants: constants,
      platformContext: { frameworkData: { target: 'xiao_ble' } } as any,
    });

    expectCppContains(result, [
      // The controller handle + the responder state against it.
      '__tc_i2c0_dev = DEVICE_DT_GET(DT_NODELABEL(i2c1))',
      'static uint8_t __tc_i2cresp0_a42_rx[48]',
      'static uint8_t __tc_i2cresp0_a42_tx[24]',
      // Registration happens once at the first op (the onReceive install).
      'i2c_target_register(__tc_i2c0_dev, &__tc_i2cresp0_a42_cfg)',
      // The callbacks land in the shim's handler slots.
      '__tc_i2cresp0_a42_on_rx = main_isr_0',
      '__tc_i2cresp0_a42_on_rq = main_isr_1',
      // The ring read clamps with the constructed size; -1 when empty.
      '__tc_i2cresp0_a42_rx[(__tc_i2cresp0_a42_tail)++ % 48U]',
      // The response fill inside onRequest.
      '__tc_i2cresp0_a42_txlen = 3U',
    ]);
  });

  it('I2C0.responder() — the bus factory lowers identically', () => {
    const constants: BoardConstants = new Map(Object.entries(JSON.parse(generateBoard('xiao_ble/nrf52840').boardJson).constants));
    const result = transpile(`
      import { I2C0 } from '@typecad/hal';

      const link = I2C0.responder(0x2A);
      link.onReceive((len: number): void => {
        const _n = len;
      });
    `, {
      strategy: new ZephyrStrategy(),
      target: 'zephyr',
      boardConstants: constants,
      platformContext: { frameworkData: { target: 'xiao_ble' } } as any,
    });

    expectCppContains(result, [
      'static uint8_t __tc_i2cresp0_a2a_rx[64]',
      'i2c_target_register(__tc_i2c0_dev, &__tc_i2cresp0_a2a_cfg)',
      '__tc_i2cresp0_a2a_on_rx = main_isr_0',
    ]);
  });

  it('the emitted shim passes --autosar=strict with zero unrecorded violations', () => {
    const constants: BoardConstants = new Map(Object.entries(JSON.parse(generateBoard('xiao_ble/nrf52840').boardJson).constants));
    const result = transpile(`
      import { I2CResponder } from '@typecad/hal';

      const link = new I2CResponder('I2C0', 0x42);
      link.onReceive((len: number): void => {
        const _n = len;
      });
      link.onRequest((): void => {
        link.write([0x01, 0x02]);
      });
    `, {
      strategy: new ZephyrStrategy(),
      target: 'zephyr',
      boardConstants: constants,
      platformContext: { frameworkData: { target: 'xiao_ble' } } as any,
      autosar: 'strict',
    });

    // The self-check the build runs over the emitted source — the responder
    // shim (platform callback signatures, casts, literals) must clear it.
    const ctx = new ComplianceContext('strict');
    const findings = runSelfCheck(ctx, result.cpp.split('\n'), (result.h ?? '').split('\n'));
    const unrecorded = findings.filter((f) => f.kind === 'unrecorded-violation');
    expect(unrecorded, unrecorded.map((f) => `${f.ruleId} @${f.line ?? ''} ${f.file}: ${f.snippet ?? ''}`).join('\n')).toEqual([]);
  });
});
