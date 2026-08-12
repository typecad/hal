import { describe, it, expect } from 'vitest';
import { lowerInterrupt, interruptInitLines } from '../../../../packages/framework-zephyr/src/lowering/interrupts';
import { ESP32_DEVKITC } from '../../../../packages/framework-zephyr/src/chips/esp32';

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
  it('attach on sw0 (pin 0) wires the full callback chain', () => {
    const out = lowerInterrupt({ operation: 'interrupt.attach', pin: 0, mode: 'falling', handler: 'myIsr' } as any, ESP32_DEVKITC);
    expect(out.code).toContain('__tc_int_sw0_handler = (myIsr)');
    expect(out.code).toContain('gpio_pin_configure_dt(&__tc_int_sw0, GPIO_INPUT)');
    expect(out.code).toContain('gpio_init_callback(&__tc_int_sw0_cb, __tc_int_sw0_tramp');
    expect(out.code).toContain('GPIO_INT_EDGE_FALLING');
    expect(out.code).toContain('gpio_pin_interrupt_configure_dt(&__tc_int_sw0, GPIO_INT_EDGE_FALLING)');
    expect(out.code).toContain('gpio_add_callback(__tc_int_sw0.port, &__tc_int_sw0_cb)');
  });

  it('attach maps mode → GPIO_INT_* flags', () => {
    const rising = lowerInterrupt({ operation: 'interrupt.attach', pin: 0, mode: 'rising', handler: 'h' } as any, ESP32_DEVKITC).code!;
    expect(rising).toContain('GPIO_INT_EDGE_RISING');
    const both = lowerInterrupt({ operation: 'interrupt.attach', pin: 0, mode: 'change', handler: 'h' } as any, ESP32_DEVKITC).code!;
    expect(both).toContain('GPIO_INT_EDGE_BOTH');
    const high = lowerInterrupt({ operation: 'interrupt.attach', pin: 0, mode: 'high', handler: 'h' } as any, ESP32_DEVKITC).code!;
    expect(high).toContain('GPIO_INT_LEVEL_HIGH');
    const low = lowerInterrupt({ operation: 'interrupt.attach', pin: 0, mode: 'low', handler: 'h' } as any, ESP32_DEVKITC).code!;
    expect(low).toContain('GPIO_INT_LEVEL_LOW');
  });

  it('detach disables + removes the callback + clears the handler', () => {
    const out = lowerInterrupt({ operation: 'interrupt.detach', pin: 0 } as any, ESP32_DEVKITC);
    expect(out.code).toContain('GPIO_INT_DISABLE');
    expect(out.code).toContain('gpio_remove_callback(__tc_int_sw0.port, &__tc_int_sw0_cb)');
    expect(out.code).toContain('__tc_int_sw0_handler = NULL');
  });

  it('attach on an unmapped pin → diagnostic comment (caught by profileDiagnostics)', () => {
    const out = lowerInterrupt({ operation: 'interrupt.attach', pin: 99, mode: 'rising', handler: 'h' } as any, ESP32_DEVKITC);
    expect(out.code).toContain('no DT spec');
  });
});
