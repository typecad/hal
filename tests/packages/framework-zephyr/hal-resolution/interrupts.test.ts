import { describe, it, expect } from 'vitest';
import { TEST_CHIP, chipForBoard } from '../helpers/test-chip';
import { lowerInterrupt, interruptInitLines, collectInterruptPins } from '../../../../packages/framework-zephyr/src/lowering/interrupts';
const ESP32_DEVKITC = chipForBoard('esp32_devkitc/esp32/procpu');


// ESP32_DEVKITC exposes the BOOT button (GPIO0) via the DT `sw0` alias and
// lists pin 0 in gpio.interruptPins, so attachInterrupt/detachInterrupt on
// pin 0 lower through the full DT-spec callback chain. (XIAO nRF52840 has no
// DT-aliased button on mainline Zephyr, so its interruptPins is empty and it
// only exercises the no-DT-spec fallback — see xiao-ble.ts for the rationale.)

describe('interrupt init block', () => {
  it('emits a gpio_callback + trampoline per interrupt pin', () => {
    const lines = interruptInitLines(ESP32_DEVKITC).join('\n');
    expect(lines).toContain('// CUTTLEFISH_INT_BEGIN');
    expect(lines).toContain('// CUTTLEFISH_INT_END');
    // sw0 (pin 0) is the ESP32 BOOT button.
    expect(lines).toContain('GPIO_DT_SPEC_GET(DT_ALIAS(sw0), gpios)');
    expect(lines).toContain('static struct gpio_callback __tc_int_sw0_cb');
    expect(lines).toContain('static void __tc_int_sw0_tramp');
  });
});

describe('interrupt lowering', () => {


  it('detach disables + removes the callback + clears the handler', () => {
    const out = lowerInterrupt({ operation: 'interrupt.detach', pin: 0 } as any, ESP32_DEVKITC);
    expect(out.code).toContain('GPIO_INT_DISABLE');
    expect(out.code).toContain('gpio_remove_callback(__tc_int_sw0.port, &__tc_int_sw0_cb)');
    expect(out.code).toContain('__tc_int_sw0_handler = NULL');
  });

});

describe('raw-path interrupts (any GPIO, no DT spec needed)', () => {


  it('detach on an unlisted pin disables + removes via the raw state', () => {
    const out = lowerInterrupt({ operation: 'interrupt.detach', pin: 5 } as any, ESP32_DEVKITC);
    expect(out.code).toContain('gpio_pin_interrupt_configure(__tc_int_raw5_dev, 5, GPIO_INT_DISABLE)');
    expect(out.code).toContain('__tc_int_raw5_handler = NULL');
  });

  it('init lines emit raw state only for attached, unlisted pins', () => {
    const lines = interruptInitLines(ESP32_DEVKITC, new Set([5, 0])).join('\n');
    // Pin 0 is sw0 (DT-spec path) — no raw duplicate.
    expect(lines).not.toContain('__tc_int_raw0_');
    // Pin 5 gets raw state.
    expect(lines).toContain('static struct gpio_callback __tc_int_raw5_cb');
    expect(lines).toContain('static void __tc_int_raw5_tramp');
  });

});
