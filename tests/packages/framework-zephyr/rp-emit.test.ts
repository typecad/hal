// ---------------------------------------------------------------------------
// End-to-end emit for the Raspberry Pi Pico boards through the real Zephyr
// strategy + board constants (the same path `cuttlefish build` takes):
//
//   - analogRead on GP26 — regression for the board-constants flattener drop
//     (the MCU's `functions: [adc(0, 0)]` helper-call style flattened to
//     nothing, so the pin-capability validator rejected every analog pin)
//   - USB0 CDC serial — the boards declare zephyr.usb (zephyr_udc0, enabled
//     in rpi_pico/rpi_pico2 DTS), so usb.* must lower against the composed
//     cdc_acm_uart0 node instead of throwing "board does not expose USB"
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';
import { transpile } from '../../setup';
import { ZephyrStrategy } from '../../../packages/framework-zephyr/src/strategy';

const rp2040 = {
  strategy: new ZephyrStrategy(),
  target: 'zephyr',
  boardPackage: '@typecad/board-rp2040',
  platformContext: { frameworkData: { buildTarget: 'rpi_pico' } } as any,
};

const rp2350 = {
  strategy: new ZephyrStrategy(),
  target: 'zephyr',
  boardPackage: '@typecad/board-rp2350',
  platformContext: { frameworkData: { buildTarget: 'rpi_pico2/rp2350a/m33' } } as any,
};

describe('RP2040 (Pico) Zephyr emit', () => {
  it('lowers analogRead on GP26 (flattened adc function entry passes the capability check)', () => {
    const result = transpile(`
      import { GP26 } from '@typecad/board-rp2040';
      const v: number = GP26.asInput().readAnalog();
      console.log('v' + v);
    `, rp2040);

    expect(result.diagnostics.some((d) => d.code === 'pin-capability-mismatch')).toBe(false);
    expect(result.cpp).toContain('__tc_adc0_setup');
    expect(result.cpp).toContain('DT_NODELABEL(adc)');
  });

  it('lowers USB0 CDC serial against the composed cdc_acm_uart0 node', () => {
    const result = transpile(`
      import { USB0 } from '@typecad/board-rp2040';
      USB0.begin();
      USB0.println('hello');
    `, rp2040);

    expect(result.diagnostics.some((d) => d.code?.startsWith?.('zephyr-usb'))).toBe(false);
    expect(result.cpp).toContain('USBD_DEVICE_DEFINE');
    expect(result.cpp).toContain('DT_NODELABEL(zephyr_udc0)');
    expect(result.cpp).toContain('DT_NODELABEL(cdc_acm_uart0)');
    expect(result.cpp).toContain('__tc_usb0_init');
  });
});

describe('RP2350 (Pico 2) Zephyr emit', () => {
  it('lowers analogRead on GP26 and the LED dtSpec in the same program', () => {
    const result = transpile(`
      import { GP25, GP26 } from '@typecad/board-rp2350';
      const led = GP25.asOutput(false);
      const v: number = GP26.asInput().readAnalog();
      led.toggle();
      console.log('v' + v);
    `, rp2350);

    expect(result.diagnostics.some((d) => d.code === 'pin-capability-mismatch')).toBe(false);
    expect(result.cpp).toContain('__tc_adc0_setup');
    // led0 alias path (GPIO_ACTIVE_HIGH from rpi_pico-led.dtsi)
    expect(result.cpp).toContain('GPIO_DT_SPEC_GET(DT_ALIAS(led0), gpios)');
  });

  it('flags pwm usage as a no-op warning instead of passing silently', () => {
    const result = transpile(`
      import { GP15 } from '@typecad/board-rp2350';
      GP15.asOutput().pwm(128);
    `, rp2350);

    expect(result.diagnostics.some((d) => d.code === 'zephyr-pwm-pin-unavailable')).toBe(true);
    expect(result.cpp).toContain('no PWM spec in chip descriptor');
  });
});
