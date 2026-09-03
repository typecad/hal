// ---------------------------------------------------------------------------
// Thin Zephyr-shaped classes (hal/gpio-pin.ts, pwm-pin.ts, adc-pin.ts,
// dac-pin.ts, watchdog.ts, counter.ts) — unit lowerings + one end-to-end
// transpile through the Zephyr strategy.
//
// The classes carry their construction facts on the ops (flag/gain tokens as
// source text); the lowerings map token names to the C macros and re-validate.
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';
import { TEST_CHIP, ESP32_DEVKITC, ESP32S3_DEVKITC } from '../helpers/test-chip';
import { lowerGpio, gpioFlagsToMacros } from '../../../../packages/framework-zephyr/src/lowering/gpio';
import { lowerPwm } from '../../../../packages/framework-zephyr/src/lowering/pwm';
import { lowerAdc } from '../../../../packages/framework-zephyr/src/lowering/adc';
import { lowerDac } from '../../../../packages/framework-zephyr/src/lowering/dac';
import { lowerWdt } from '../../../../packages/framework-zephyr/src/lowering/wdt';
import { lowerCounter } from '../../../../packages/framework-zephyr/src/lowering/hwtimer';
import { lowerInterrupt } from '../../../../packages/framework-zephyr/src/lowering/interrupts';

import { transpileZephyrStrategy, transpile, expectCppContains } from '../../../setup';
import { blackpillRev19 } from '../helpers/blackpill-rev19';
import { ZephyrStrategy } from '../../../../packages/framework-zephyr/src/strategy';
import { generateBoard } from '../../../../packages/framework-zephyr/src/boardgen';
import type { BoardConstants } from '../../../../packages/cuttlefish/src/api/shared/board-resolver';
function generatedConstants(target: string): BoardConstants {
  const g = generateBoard(target);
  return new Map(Object.entries(JSON.parse(g.boardJson).constants)) as BoardConstants;
}


// ── GPIO ────────────────────────────────────────────────────────────────────

describe('thin GPIO lowering', () => {
  it('flag tokens map name-for-name to GPIO_* macros', () => {
    expect(gpioFlagsToMacros('GPIO.OUTPUT | GPIO.PULL_UP')).toBe('GPIO_OUTPUT | GPIO_PULL_UP');
    expect(gpioFlagsToMacros('GPIO.INPUT')).toBe('GPIO_INPUT');
    expect(gpioFlagsToMacros('GPIO.OUTPUT | GPIO.OUTPUT_INIT_LOW | GPIO.OPEN_DRAIN'))
      .toBe('GPIO_OUTPUT | GPIO_OUTPUT_INIT_LOW | GPIO_OPEN_DRAIN');
  });

  it('unknown flag tokens are build errors naming the valid spellings', () => {
    expect(() => gpioFlagsToMacros('GPIO.OUTPT')).toThrow(/GPIO\.OUTPT.*GPIO\.OUTPUT/s);
  });

  it('configure on a dtSpec pin is guarded (once) and uses gpio_pin_configure_dt', () => {
    // XIAO led0 = pin 26.
    const out = lowerGpio({ operation: 'gpio.configure', pin: 26, flags: 'GPIO.OUTPUT | GPIO.OUTPUT_INIT_LOW' } as any, TEST_CHIP);
    expect(out.code).toContain('__tc_gpio_cfg_led0_done');
    expect(out.code).toContain('gpio_pin_configure_dt(&__tc_dt_led0, GPIO_OUTPUT | GPIO_OUTPUT_INIT_LOW)');
  });

  it('configure on a raw pin uses the controller path with the pin-relative bit', () => {
    const out = lowerGpio({ operation: 'gpio.configure', pin: 5, flags: 'GPIO.INPUT | GPIO.PULL_DOWN' } as any, ESP32S3_DEVKITC);
    expect(out.code).toContain('__tc_gpio_cfg_raw5_done');
    expect(out.code).toContain('gpio_pin_configure(DEVICE_DT_GET(DT_NODELABEL(gpio0)), 5, GPIO_INPUT | GPIO_PULL_DOWN)');
  });

  it('attach_flags on a dtSpec interrupt pin maps INT tokens verbatim', () => {
    // ESP32-S3 BOOT button sw0 = pin 0 (also in interruptPins).
    const out = lowerInterrupt({ operation: 'interrupt.attach_flags', pin: 0, handler: 'onPress', intFlags: 'GPIO.INT_EDGE_FALLING' } as any, ESP32S3_DEVKITC);
    expect(out.code).toContain('__tc_int_sw0_handler = (onPress);');
    expect(out.code).toContain('gpio_pin_interrupt_configure_dt(&__tc_int_sw0, GPIO_INT_EDGE_FALLING)');
    // The construction flags already configured the pin — no INPUT override.
    expect(out.code).not.toContain('gpio_pin_configure_dt(&__tc_int_sw0, GPIO_INPUT)');
  });

  it('unknown INT tokens are build errors', () => {
    expect(() =>
      lowerInterrupt({ operation: 'interrupt.attach_flags', pin: 0, handler: 'h', intFlags: 'GPIO.INT_FALLING' } as any, ESP32S3_DEVKITC),
    ).toThrow(/GPIO\.INT_FALLING.*GPIO\.INT_EDGE_FALLING/s);
  });
});

// ── PWM ─────────────────────────────────────────────────────────────────────

describe('thin PWM lowering', () => {
  it('set_pulse applies the construction period once, then pwm_set_pulse_dt', () => {
    const out = lowerPwm({ operation: 'pwm.set_pulse', pin: 17, periodNs: 20000000, pulseNs: 1500000 } as any, TEST_CHIP);
    expect(out.code).toContain('static bool __tc_pwm_p17_prd = false');
    expect(out.code).toContain('pwm_set_dt(&__tc_pwm_pwm_led0, 20000000, 0)');
    expect(out.code).toContain('pwm_set_pulse_dt(&__tc_pwm_pwm_led0, 1500000)');
    expect(out.code).not.toContain('/ 255');
  });

  it('set_duty scales the fraction 0.0–1.0 against the construction period (one call)', () => {
    const out = lowerPwm({ operation: 'pwm.set_duty', pin: 17, periodNs: 20000000, duty: 0.75 } as any, TEST_CHIP);
    expect(out.code).toContain('pwm_set_pulse_dt(&__tc_pwm_pwm_led0, static_cast<uint32_t>(static_cast<double>(0.75) * static_cast<double>(20000000)))');
  });

  it('set_period lowers to pwm_set_dt with an idle pulse (no period-only API)', () => {
    const out = lowerPwm({ operation: 'pwm.set_period', pin: 17, periodNs: 50000000 } as any, TEST_CHIP);
    expect(out.code).toBe('(void)pwm_set_dt(&__tc_pwm_pwm_led0, 50000000, 0);');
  });

  it('matrix pins (ESP32 LEDC) resolve through the synthesized tc-pwm alias', () => {
    const out = lowerPwm({ operation: 'pwm.set_pulse', pin: 5, periodNs: 1000000, pulseNs: 250000 } as any, ESP32S3_DEVKITC);
    expect(out.code).toContain('&__tc_pwm_tc_pwm5');
  });
});

// ── ADC ─────────────────────────────────────────────────────────────────────

describe('thin ADC lowering', () => {
  it('read_raw does lazy inline channel setup then adc_read', () => {
    // XIAO AIN0 = P0.02 = pin 2.
    const out = lowerAdc({ operation: 'adc.read_raw', pin: 2, gain: '', reference: '' } as any, TEST_CHIP);
    expect(out.expression).toContain('__tc_adct2_done');
    // Descriptor defaults (nRF SAADC pair) when no tokens given.
    expect(out.expression).toContain('.gain = ADC_GAIN_1_4');
    expect(out.expression).toContain('.reference = ADC_REF_INTERNAL');
    expect(out.expression).toContain('adc_channel_setup(__tc_adc_dev');
    expect(out.expression).toMatch(/adc_read\(__tc_adc_dev, &__s\); __b; \}\)$/);
  });

  it('read_raw honors construction gain/reference tokens over the descriptor', () => {
    const out = lowerAdc({ operation: 'adc.read_raw', pin: 2, gain: 'ADC.GAIN_1_6', reference: 'ADC.REF_VDD_1' } as any, TEST_CHIP);
    expect(out.expression).toContain('.gain = ADC_GAIN_1_6');
    expect(out.expression).toContain('.reference = ADC_REF_VDD_1');
  });

  it('read_mv converts via adc_raw_to_millivolts with the setup gain', () => {
    const out = lowerAdc({ operation: 'adc.read_mv', pin: 2, gain: 'ADC.GAIN_1', reference: '' } as any, TEST_CHIP);
    expect(out.expression).toContain('adc_raw_to_millivolts(3000, ADC_GAIN_1, 12, &__v)');
  });

  it('unknown gain tokens are build errors naming the valid spellings', () => {
    expect(() =>
      lowerAdc({ operation: 'adc.read_raw', pin: 2, gain: 'ADC.GAIN_QUARTER', reference: '' } as any, TEST_CHIP),
    ).toThrow(/GAIN_QUARTER.*ADC\.GAIN_1_4/s);
  });
});

// ── DAC ─────────────────────────────────────────────────────────────────────

describe('thin DAC lowering', () => {
  it('write_value sets up lazily with the construction resolution, then dac_write_value', () => {
    // ESP32 GPIO25 = DAC channel 1 (8-bit in the descriptor).
    const out = lowerDac({ operation: 'dac.write_value', pin: 25, value: 128, resolution: 0 } as any, ESP32_DEVKITC);
    expect(out.code).toContain('__tc_dact25_done');
    expect(out.code).toContain('.channel_id = 1, .resolution = 8');
    expect(out.code).toContain('dac_write_value(__tc_dac_dev, 1, 128)');
  });

  it('construction resolution overrides the descriptor channel resolution', () => {
    const out = lowerDac({ operation: 'dac.write_value', pin: 25, value: 2048, resolution: 12 } as any, ESP32_DEVKITC);
    expect(out.code).toContain('.resolution = 12');
  });
});

// ── Watchdog ────────────────────────────────────────────────────────────────

describe('thin Watchdog lowering', () => {
  it('setup installs the construction timeout (ms) and arms — no WDTO parsing', () => {
    const out = lowerWdt({ operation: 'wdt.setup', timeoutMs: 2500 } as any, TEST_CHIP);
    expect(out.code).toContain('.max = 2500');
    expect(out.code).toContain('wdt_install_timeout(__tc_wdt_dev');
    expect(out.code).toContain('wdt_setup(__tc_wdt_dev');
  });

  it('feed lowers to wdt_feed on the installed channel', () => {
    const out = lowerWdt({ operation: 'wdt.feed' } as any, TEST_CHIP);
    expect(out.code).toBe('if (__tc_wdt_channel >= 0) { wdt_feed(__tc_wdt_dev, __tc_wdt_channel); }');
  });
});

// ── Counter ─────────────────────────────────────────────────────────────────

describe('thin Counter lowering', () => {
  it('on_alarm stores the handler on the instance callback var', () => {
    const out = lowerCounter({ operation: 'counter.on_alarm', instance: 0, handler: 'tick' } as any, TEST_CHIP);
    expect(out.code).toBe('__tc_hw_cb_0 = (tick);');
  });

  it('start applies the construction hz as the top value and starts', () => {
    const out = lowerCounter({ operation: 'counter.start', instance: 0, hz: 1000 } as any, TEST_CHIP);
    expect(out.code).toContain('__tc_hw_hz_0 = 1000;');
    expect(out.code).toContain('counter_get_frequency(__tc_hw_dev_0)');
    expect(out.code).toContain('counter_set_top_value(__tc_hw_dev_0');
    expect(out.code).toContain('counter_start(__tc_hw_dev_0)');
  });

  it('stop halts the counter', () => {
    const out = lowerCounter({ operation: 'counter.stop', instance: 0 } as any, TEST_CHIP);
    expect(out.code).toBe('(void)counter_stop(__tc_hw_dev_0);');
  });

  it('out-of-range instances lower to a comment naming the count', () => {
    const out = lowerCounter({ operation: 'counter.start', instance: 3, hz: 10 } as any, TEST_CHIP);
    expect(out.code).toContain('out of range');
  });
});

// ── End-to-end: user code → resolver → lowering ─────────────────────────────

describe('thin classes end-to-end (esp32s3 target)', () => {
  it('GPIO/PWM construction facts flow through the resolver into the lowered C++', () => {
    // PWM construction needs the LEDC matrix — a synthetic silicon fact the
    // board DTS does not carry, injected with the generated constants.
    const constants = generatedConstants('esp32s3_devkitc/esp32s3/procpu');
    constants.set('zephyr.pwm.matrix.controller', 'ledc0');
    constants.set('zephyr.pwm.matrix.channelCount', 8);
    for (let i = 0; i < 49; i++) constants.set(`zephyr.pwm.matrix.pins.${i}`, i);
    const result = transpile(`
      import { GPIO, PWM } from '@typecad/hal';

      const led = new GPIO(5, GPIO.OUTPUT | GPIO.OUTPUT_INIT_LOW);
      const dimmer = new PWM(6, { periodNs: 1000000 });

      led.set(true);
      led.toggle();
      dimmer.setPulse(250000);
      dimmer.setDuty(0.5);
      dimmer.setPeriod(20000000);
    `, {
      strategy: new ZephyrStrategy(),
      target: 'zephyr',
      boardConstants: constants,
      platformContext: { frameworkData: { target: 'esp32s3_devkitc' } } as any,
    });

    expectCppContains(result, [
      '__tc_gpio_cfg_raw5_done',
      'gpio_pin_configure(DEVICE_DT_GET(DT_NODELABEL(gpio0)), 5, GPIO_OUTPUT | GPIO_OUTPUT_INIT_LOW)',
      'gpio_pin_set_raw(DEVICE_DT_GET(DT_NODELABEL(gpio0)), 5, 1)',
      'gpio_pin_toggle(DEVICE_DT_GET(DT_NODELABEL(gpio0)), 5)',
      'pwm_set_dt(&__tc_pwm_tc_pwm6, 1000000, 0)',
      'pwm_set_pulse_dt(&__tc_pwm_tc_pwm6, 250000)',
      'static_cast<double>(0.5f) * static_cast<double>(1000000)',
      'pwm_set_dt(&__tc_pwm_tc_pwm6, 20000000, 0)',
    ]);
  });

  it('get() in an if-condition FUSES the guarded configure into the read (no dropped side-effect op)', () => {
    // Regression: a method whose body emits a side-effect op BEFORE the
    // value-returning op loses the side effect in pure expression positions
    // (tryResolveHALExpression keeps only the last op) — the blackpill demo's
    // `if (button.get())` never configured PA0, so the button floated.
    const result = transpileZephyrStrategy(`
      import { GPIO } from '@typecad/hal';
      const button = new GPIO(0, GPIO.INPUT | GPIO.PULL_UP);
      if (button.get()) { console.log('pressed'); }
    `);
    expectCppContains(result, [
      'static bool __tc_gpio_cfg_sw0_done',
      'gpio_pin_configure_dt(&__tc_dt_sw0, GPIO_INPUT | GPIO_PULL_UP)',
      'gpio_pin_get_dt(&__tc_dt_sw0)',
    ]);
  });

  it('GPIO interrupts with INT tokens flow through the resolver (dtSpec path)', () => {
    const result = transpileZephyrStrategy(`
      import { GPIO } from '@typecad/hal';

      const button = new GPIO(0, GPIO.INPUT | GPIO.PULL_UP);
      button.onInterrupt(GPIO.INT_EDGE_FALLING, (): void => { });
      button.offInterrupt();
    `);

    expectCppContains(result, [
      '__tc_gpio_cfg_sw0_done',
      'gpio_pin_configure_dt(&__tc_dt_sw0, GPIO_INPUT | GPIO_PULL_UP)',
      '__tc_int_sw0_handler = (',
      'gpio_pin_interrupt_configure_dt(&__tc_int_sw0, GPIO_INT_EDGE_FALLING)',
      'gpio_remove_callback(__tc_int_sw0.port, &__tc_int_sw0_cb)',
    ]);
  });
});

// ── Value ops nested in another HAL call's argument ─────────────────────────
//
// Same bug class as the blackpill ADC demo: a thin-class read nested inside
// another HAL method's argument (`USB0.writeLine(\`v: ${x.get()}\`)`,
// `flag.set(uart.read() > 0)`) is inlined into the enclosing method's emit
// TEXT during the build — it never becomes a hal-op/hal-expr IR node. Two
// things must hold: the op's lowering runs with the chip already resolved
// (prepareChip now fires when board constants land, BEFORE the first nested
// resolution), and the analysis flags must come from the lowering's
// resolved-op record (or the gated include + init block are dropped and the
// generated C++ references undeclared symbols).

describe('value ops nested in another HAL call (resolved-op record regression)', () => {
  function transpileBlackpill(code: string) {
    const { boardTs, boardConstants } = blackpillRev19();
    return transpile(code, {
      strategy: new ZephyrStrategy(),
      boardConstants,
      boardTs,
      platformContext: { frameworkData: { target: 'blackpill_f411ce' } } as never,
    });
  }

  it('GPIO.get nested in USB0.writeLine uses the chip controller split (not the gpio0 default)', () => {
    // Pin 21 on the gpioa 0-15 / gpioc 16-31 fixture split → gpioc bit 5.
    // With the chip unresolved at lowering time this fell back to the
    // 'gpio0' default — a nodelabel no STM32 devicetree defines.
    const result = transpileBlackpill(`
      import { GPIO } from '@typecad/hal';
      import { USB0 } from '@typecad/board';
      const key = new GPIO(21, GPIO.INPUT | GPIO.PULL_UP);
      USB0.open();
      USB0.writeLine(\`k: \${key.get()}\`);
    `);
    const errs = (result.diagnostics ?? []).filter((d) => d.severity === 'error');
    expect(errs.map((d) => d.message)).toEqual([]);
    expectCppContains(result, [
      'gpio_pin_configure(DEVICE_DT_GET(DT_NODELABEL(gpioc)), 5, GPIO_INPUT | GPIO_PULL_UP)',
      'gpio_pin_get_raw(DEVICE_DT_GET(DT_NODELABEL(gpioc)), 5)',
    ]);
    // The unresolved-stub leak shape (emit.ts names surfacing in user code).
    expect(result.cpp).not.toContain('gpioReadCfg(');
  });

  it('UART.read nested in a GPIO.set argument keeps uart.h + the UART init block', () => {
    // Before the resolved-op record, usesUart stayed false for this program:
    // the uart.h include and the __tc_uart0 init were dropped while the
    // lowered read text still referenced them.
    const result = transpileBlackpill(`
      import { GPIO, UART } from '@typecad/hal';
      import { USB0 } from '@typecad/board';
      const gps = new UART('UART0');
      const flag = new GPIO(21, GPIO.OUTPUT);
      USB0.open();
      flag.set(gps.read() > 0);
    `);
    const errs = (result.diagnostics ?? []).filter((d) => d.severity === 'error');
    expect(errs.map((d) => d.message)).toEqual([]);
    expectCppContains(result, [
      '#include <zephyr/drivers/uart.h>',
      '__tc_uart0_dev',
      'uart_irq_rx_enable',
    ]);
  });
});
