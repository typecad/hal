import { describe, it, expect } from 'vitest';
import { lowerInterrupt, interruptInitLines } from '../../../../packages/framework-zephyr/src/lowering/interrupts';
import { XIAO_BLE } from '../../../../packages/framework-zephyr/src/chips/xiao-ble';

describe('interrupt init block', () => {
  it('emits a gpio_callback + trampoline per interrupt pin', () => {
    const lines = interruptInitLines(XIAO_BLE).join('\n');
    expect(lines).toContain('// CUTTLEFISH_INT_BEGIN');
    expect(lines).toContain('// CUTTLEFISH_INT_END');
    // sw0 (pin 4) is the XIAO user button (B2 fix).
    expect(lines).toContain('GPIO_DT_SPEC_GET(DT_ALIAS(sw0), gpios)');
    expect(lines).toContain('static struct gpio_callback __tc_int_sw0_cb');
    expect(lines).toContain('static void __tc_int_sw0_tramp');
  });
});

describe('interrupt lowering', () => {
  it('attach on sw0 (pin 4) wires the full callback chain', () => {
    const out = lowerInterrupt({ operation: 'interrupt.attach', pin: 4, mode: 'falling', handler: 'myIsr' } as any, XIAO_BLE);
    expect(out.code).toContain('__tc_int_sw0_handler = (myIsr)');
    expect(out.code).toContain('gpio_pin_configure_dt(&__tc_int_sw0, GPIO_INPUT)');
    expect(out.code).toContain('gpio_init_callback(&__tc_int_sw0_cb, __tc_int_sw0_tramp');
    expect(out.code).toContain('GPIO_INT_EDGE_FALLING');
    expect(out.code).toContain('gpio_pin_interrupt_configure_dt(&__tc_int_sw0, GPIO_INT_EDGE_FALLING)');
    expect(out.code).toContain('gpio_add_callback(__tc_int_sw0.port, &__tc_int_sw0_cb)');
  });

  it('attach maps mode → GPIO_INT_* flags', () => {
    const rising = lowerInterrupt({ operation: 'interrupt.attach', pin: 4, mode: 'rising', handler: 'h' } as any, XIAO_BLE).code!;
    expect(rising).toContain('GPIO_INT_EDGE_RISING');
    const both = lowerInterrupt({ operation: 'interrupt.attach', pin: 4, mode: 'change', handler: 'h' } as any, XIAO_BLE).code!;
    expect(both).toContain('GPIO_INT_EDGE_BOTH');
    const high = lowerInterrupt({ operation: 'interrupt.attach', pin: 4, mode: 'high', handler: 'h' } as any, XIAO_BLE).code!;
    expect(high).toContain('GPIO_INT_LEVEL_HIGH');
    const low = lowerInterrupt({ operation: 'interrupt.attach', pin: 4, mode: 'low', handler: 'h' } as any, XIAO_BLE).code!;
    expect(low).toContain('GPIO_INT_LEVEL_LOW');
  });

  it('detach disables + removes the callback + clears the handler', () => {
    const out = lowerInterrupt({ operation: 'interrupt.detach', pin: 4 } as any, XIAO_BLE);
    expect(out.code).toContain('GPIO_INT_DISABLE');
    expect(out.code).toContain('gpio_remove_callback(__tc_int_sw0.port, &__tc_int_sw0_cb)');
    expect(out.code).toContain('__tc_int_sw0_handler = NULL');
  });

  it('attach on an unmapped pin → diagnostic comment (caught by profileDiagnostics)', () => {
    const out = lowerInterrupt({ operation: 'interrupt.attach', pin: 99, mode: 'rising', handler: 'h' } as any, XIAO_BLE);
    expect(out.code).toContain('no DT spec');
  });
});
