// ---------------------------------------------------------------------------
// End-to-end emit for the Raspberry Pi Pico boards through the real Zephyr
// strategy + board constants (the same path `cuttlefish build` takes) —
// now on the thin HAL (ADCChannel/GPIO; legacy GPIO classes removed):
//
//   - ADCChannel on GP26 — regression for the board-constants flattener drop
//     (the MCU's `functions: [adc(0, 0)]` helper-call style flattened to
//     nothing, so the pin-capability validator rejected every analog pin)
//   - USB0 CDC serial — the boards declare zephyr.usb (zephyr_udc0, enabled
//     in rpi_pico/rpi_pico2 DTS), so usb.* must lower against the composed
//     cdc_acm_uart0 node instead of throwing "board does not expose USB"
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';
import { transpile } from '../../setup';
import { ZephyrStrategy } from '../../../packages/framework-zephyr/src/strategy';

import { generateBoard } from '../../../packages/framework-zephyr/src/boardgen';
function genConstants(target: string) {
  return new Map(Object.entries(JSON.parse(generateBoard(target).boardJson).constants));
}

const rp2040 = {
  strategy: new ZephyrStrategy(),
  target: 'zephyr',
  boardConstants: genConstants('rpi_pico/rp2040'),
  platformContext: { frameworkData: { buildTarget: 'rpi_pico/rp2040' } } as any,
};

const rp2350 = {
  strategy: new ZephyrStrategy(),
  target: 'zephyr',
  boardConstants: genConstants('rpi_pico2/rp2350a/m33'),
  platformContext: { frameworkData: { buildTarget: 'rpi_pico2/rp2350a/m33' } } as any,
};

describe('RP2040 (Pico) Zephyr emit', () => {
  it('lowers ADCChannel.read on GP26 (capability check via flattened adc functions)', () => {
    const result = transpile(`
      import { ADCChannel } from '@typecad/hal';
      const sense = new ADCChannel(26); // GP26
      const v: number = sense.read();
      console.log('v' + v);
    `, rp2040);

    expect(result.diagnostics.some((d) => d.code === 'pin-capability-mismatch')).toBe(false);
    expect(result.cpp).toContain('__tc_adc');
    expect(result.cpp).toContain('DT_NODELABEL(adc)');
  });

  it('lowers USB0 CDC serial against the composed cdc_acm_uart0 node', () => {
    const result = transpile(`
      const USB0 = 'USB0'; // composed CDC node
      USB0.open();
      USB0.writeLine('hello');
    `, rp2040);

    expect(result.diagnostics.some((d) => d.code?.startsWith?.('zephyr-usb'))).toBe(false);
    expect(result.cpp).toContain('USBD_DEVICE_DEFINE');
    expect(result.cpp).toContain('DT_NODELABEL(zephyr_udc0)');
    expect(result.cpp).toContain('DT_NODELABEL(cdc_acm_uart0)');
    expect(result.cpp).toContain('__tc_usb0_init();');   // no baud — CDC line coding is host-owned
  });
});

describe('RP2350 (Pico 2) Zephyr emit', () => {
  it('lowers a thin-GPIO LED toggle and an ADC read in the same program', () => {
    const result = transpile(`
      const GP25 = 25;
const GP26 = 26;
      import { GPIO, ADCChannel } from '@typecad/hal';
      const led = new GPIO(25, // GP25
 GPIO.OUTPUT);
      const sense = new ADCChannel(26);
      led.toggle();
      console.log('v' + sense.read());
    `, rp2350);

    expect(result.diagnostics.some((d) => d.code === 'pin-capability-mismatch')).toBe(false);
    expect(result.cpp).toContain('__tc_adc');
    // led0 alias path (GPIO_ACTIVE_HIGH from rpi_pico-led.dtsi)
    expect(result.cpp).toContain('GPIO_DT_SPEC_GET(DT_ALIAS(led0), gpios)');
  });

  it('builds a plain thin program cleanly for this board config', () => {
    const result = transpile(`
      const GP15 = 15; // RP2350
      void GP15;
    `, rp2350);

    expect(result.cpp.length).toBeGreaterThan(0);
  });
});
