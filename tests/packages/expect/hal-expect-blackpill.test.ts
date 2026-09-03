// ---------------------------------------------------------------------------
// Blackpill dry-run — isolated file. The beforeAll resolves the board package
// constants and runs a full transpile of the suite program; that workload
// takes seconds standalone but can exceed the default 60s hook timeout under
// a full parallel battery (CPU contention — the same class of slowdown that
// hits the board-resolver tests in create-framework.test.ts), so the hook
// carries an explicit 180s timeout. Splitting it out also keeps its
// board-derived chip resolution in its own vitest fork.
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeAll } from 'vitest';
import * as path from 'node:path';
import { preprocess, zephyrShim } from '../../../packages/expect/src/host/preprocessor';
import { generateBoard } from '../../../packages/framework-zephyr/src/boardgen';

import { resolveChipFromBoard } from '../../../packages/framework-zephyr/src/chips/resolve';
import { ZephyrStrategy } from '../../../packages/framework-zephyr/src/strategy';
import { transpile, expectCppContains, type TranspileResult } from '../../setup';
import type { BoardConstants } from '../../../packages/cuttlefish/src/api/shared/index';

const _strategy = new ZephyrStrategy();

/** Preprocess + transpile one user test file — same as the main suite's helper. */
function dryRun(source: string, boardConstants?: BoardConstants): TranspileResult {
  const rewritten = preprocess(source, 'blackpill.test.ts', { shim: zephyrShim });
  return transpile(rewritten, {
    strategy: _strategy,
    target: 'zephyr',
    ...(boardConstants ? { boardConstants } : {}),
  });
}

/** Same program shape as the main suite's helper (duplicated so this file
 *  stays independent of the other file's globals). */
function suiteProgram(f: {
  ledPin: number; buttonPin: number; pwmPin: number; adcPin: number;
  i2cBus: string; spiBus: string; spiCs: number;
}): string {
  return `
import { describe, done } from '@typecad/expect';
import { GPIO, PWM, ADC, Watchdog, I2CTarget, SPITarget, Thread, Time } from '@typecad/hal';

const led = new GPIO(${f.ledPin}, GPIO.OUTPUT);
const button = new GPIO(${f.buttonPin}, GPIO.INPUT | GPIO.PULL_UP);
const dimmer = new PWM(${f.pwmPin}, { periodNs: 20000000 });
const sense = new ADC(${f.adcPin});
const dog = new Watchdog(2500);
const sht = new I2CTarget('${f.i2cBus}', 0x44);
const flash = new SPITarget('${f.spiBus}', ${f.spiCs}, { hz: 10000000 });
const id = new Uint8Array(4);
const worker = new Thread(0, { stackKb: 4 });

worker.start((): void => { Time.sleep(100); });
dog.enable();
led.set(true);
dimmer.setDuty(0.5);
flash.transceive([0x9F], id);

describe('thin HAL')
  .it('clock reads monotonic ms').expect(Time.now()).toBeGreaterThan(0)
  .it('button reads logically').expect(button.get()).toBeFalsy()
  .it('adc reads raw counts').expect(sense.read()).toBeWithinRange(0, 4095)
  .it('i2c register byte').expect(sht.readReg(0x32)).toBeWithinRange(0, 255);

dog.feed();
worker.join();
done();
`;
}

// ── The blackpill dry run ───────────────────────────────────────────────────

describe('hal expect suite — blackpill dry run', () => {
  let bc: BoardConstants;
  let result: TranspileResult;

  beforeAll(() => {
    // Board constants from the generated board module (boardgen) — the
    // board package is gone; the same facts live in the emitted board.json.
    bc = new Map(Object.entries(
      JSON.parse(generateBoard('blackpill_f411ce/stm32f411xe').boardJson).constants,
    )) as BoardConstants;
    result = dryRun(suiteProgram({
      // PC13 (led0) = 16 + 13 under the derived 16-wide letter-port rule;
      // PA0 (sw0). The board wires i2c1 + spi1.
      ledPin: 29, buttonPin: 0, pwmPin: 22, adcPin: 0,
      i2cBus: 'I2C0', spiBus: 'SPI0', spiCs: 4,
    }), bc);
  }, 180_000);

  it('every thin class lowered with the blackpill\'s own facts', () => {
    expectCppContains(result, [
      // led0 dtSpec (PC13 = HAL 29).
      '__tc_gpio_cfg_led0_done',
      'gpio_pin_configure_dt(&__tc_dt_led0, GPIO_OUTPUT)',
      'gpio_pin_set_dt(&__tc_dt_led0, 1)',
      // sw0 (PA0) — the board's DT-aliased button.
      'gpio_pin_get_dt(&__tc_dt_sw0)',
      // i2c1 / spi1 (both controller index 0 on this board).
      'i2c_reg_read_byte(__tc_i2c0_dev',
      'spi_transceive_dt(&__tc_spit_spi0_cs4_spec',
      // Thread — board-independent kernel surface.
      'K_THREAD_STACK_DEFINE(__tc_thrd0_stack, 4096)',
      'k_thread_create(&__tc_thrd0_thread',
    ]);
  });

  it('the protocol markers survived the blackpill transpile too', () => {
    expectCppContains(result, ['[TC:SUITE_START]', '[TC:DESCRIBE:thin HAL]', '[TC:SUITE_END]']);
  });
});
