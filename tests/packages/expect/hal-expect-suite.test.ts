// ---------------------------------------------------------------------------
// HAL expect-based testing suite — thin HAL through the @typecad/expect
// pipeline, dry-run (preprocess → transpile, no compile/upload/serial).
//
// Each case takes a REAL user test file (the fluent describe/it/expect
// syntax), runs it through the expect preprocessor with the Zephyr output
// shim, transpiles the rewritten source through the Zephyr strategy, and
// asserts both halves:
//   1. the serial protocol survived (__tc_print lines, [TC:* markers)
//   2. every thin-HAL construction fact lowered to the right Zephyr C++
//
// The blackpill board dry run lives in its own file
// (hal-expect-blackpill.test.ts): its chip descriptor is derived from the
// board package's flattened constants (the production resolveChipFromBoard
// path — no hardcoded registry).
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as path from 'node:path';
import { preprocess, zephyrShim } from '../../../packages/expect/src/host/preprocessor';
import { resolveChipFromBoard } from '../../../packages/framework-zephyr/src/chips/resolve';
import { getActiveChip, setActiveChip, XIAO_BLE } from '../../../packages/framework-zephyr/src/chips/index';
import { ZephyrStrategy } from '../../../packages/framework-zephyr/src/strategy';
import { transpile, expectCppContains, type TranspileResult } from '../../setup';
import type { BoardConstants } from '../../../packages/cuttlefish/src/api/shared/index';

const _strategy = new ZephyrStrategy();
// The chip descriptor is module-global in framework-zephyr — the blackpill
// dry run repoints it, which leaks into any test file sharing this vitest
// worker. Restore the default on the way out.
const _chipBefore = getActiveChip();
afterAll(() => setActiveChip(_chipBefore));

/** Preprocess + transpile one user test file — the dry run. */
function dryRun(source: string, boardConstants?: BoardConstants): TranspileResult {
  const rewritten = preprocess(source, 'hal.test.ts', { shim: zephyrShim });
  return transpile(rewritten, {
    strategy: _strategy,
    target: 'zephyr',
    ...(boardConstants ? { boardConstants } : {}),
  });
}

/** Build the suite program for one board's facts. */
function suiteProgram(f: {
  ledPin: number;
  buttonPin: number;
  pwmPin: number;
  adcPin: number;
  i2cBus: string;
  spiBus: string;
  spiCs: number;
}): string {
  return `
import { describe, done } from '@typecad/expect';
import { GPIO, PWM, ADCChannel, Watchdog, I2CTarget, SPITarget, Thread, Time } from '@typecad/hal';

const led = new GPIO(${f.ledPin}, GPIO.OUTPUT);
const button = new GPIO(${f.buttonPin}, GPIO.INPUT | GPIO.PULL_UP);
const dimmer = new PWM(${f.pwmPin}, { periodNs: 20000000 });
const sense = new ADCChannel(${f.adcPin});
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
  .it('clock reads monotonic ms')
    .expect(Time.now()).toBeGreaterThan(0)
  .it('button reads logically')
    .expect(button.get()).toBeTruthy()
  .it('adc reads raw counts')
    .expect(sense.read()).toBeWithinRange(0, 4095)
  .it('i2c register byte')
    .expect(sht.readReg(0x32)).toBeWithinRange(0, 255);

dog.feed();
worker.join();

done();
`;
}

// ── Protocol survival (board-independent) ───────────────────────────────────

describe('hal expect suite — protocol (XIAO facts)', () => {
  let result: TranspileResult;
  beforeAll(() => {
    result = dryRun(suiteProgram({
      ledPin: 26, buttonPin: 3, pwmPin: 17, adcPin: 2,
      i2cBus: 'I2C1', spiBus: 'SPI2', spiCs: 10,
    }));
  }, 180_000);

  it('the expect preprocessor protocol survived transpilation', () => {
    expectCppContains(result, [
      '__tc_println("[TC:SUITE_START]")',
      '[TC:DESCRIBE:thin HAL]',
      '[TC:EXPECT:',
      '[TC:SUITE_END]',
    ]);
  });

  it('the Zephyr shim helpers were emitted', () => {
    expectCppContains(result, [
      'inline void __tc_print(const char* s)',
      '__tc_println',
    ]);
  });

  it('every thin class lowered (XIAO facts)', () => {
    expectCppContains(result, [
      // Time.now — hoisted by the preprocessor into a const, printed.
      'static_cast<double>(k_uptime_get())',
      // GPIO: guarded configure on the led0 dtSpec, logical set. The XIAO
      // has no sw0 dtSpec — the button takes the raw-controller path.
      '__tc_gpio_cfg_led0_done',
      'gpio_pin_configure_dt(&__tc_dt_led0, GPIO_OUTPUT)',
      'gpio_pin_set_dt(&__tc_dt_led0, 1)',
      'gpio_pin_configure(DEVICE_DT_GET(DT_NODELABEL(gpio0)), 3, GPIO_INPUT | GPIO_PULL_UP)',
      'gpio_pin_get_raw(DEVICE_DT_GET(DT_NODELABEL(gpio0)), 3)',
      // PWM: construction period + one set_pulse (XIAO pwm-led0 spec).
      'pwm_set_dt(&__tc_pwm_pwm_led0, 20000000, 0)',
      'pwm_set_pulse_dt(&__tc_pwm_pwm_led0',
      // ADCChannel: lazy inline setup against the descriptor pair.
      '__tc_adct2_done',
      'adc_channel_setup(__tc_adc_dev',
      // Watchdog: install + setup.
      'wdt_install_timeout(__tc_wdt_dev',
      // I2CTarget: Zephyr register verb on the i2c1 controller.
      'i2c_reg_read_byte(__tc_i2c1_dev',
      // SPITarget: spi_dt_spec transceive on spi2.
      'spi_transceive_dt(&__tc_spit_spi2_cs10_spec',
      // Thread: sized stack + create + join.
      'K_THREAD_STACK_DEFINE(__tc_thrd0_stack, 4096)',
      'k_thread_create(&__tc_thrd0_thread',
      'k_thread_join(&__tc_thrd0_thread, K_FOREVER)',
    ]);
  });
});
