import { describe, it, expect } from 'vitest';
import { lowerInterrupts, interruptsInitLines } from '../../../../packages/framework-esp32/src/lowering/interrupts';

describe('interrupts init block', () => {
  it('emits CUTTLEFISH_INTR markers + gpio_install_isr_service', () => {
    const lines = interruptsInitLines().join('\n');
    expect(lines).toContain('// CUTTLEFISH_INTR_BEGIN');
    expect(lines).toContain('// CUTTLEFISH_INTR_END');
    expect(lines).toContain('gpio_install_isr_service');
  });
});

describe('interrupts lowering', () => {
  it('attach with rising mode → install + GPIO_INTR_POSEDGE + isr_handler_add', () => {
    const out = lowerInterrupts({ operation: 'interrupt.attach', pin: 4, handler: 'onRise', mode: 'rising' }).code!;
    expect(out).toContain('__tc_intr_install()');
    expect(out).toContain('GPIO_INTR_POSEDGE');
    expect(out).toContain('gpio_isr_handler_add((gpio_num_t)4, (void(*)(void*))onRise, NULL)');
  });
  it('attach with falling mode → GPIO_INTR_NEGEDGE', () => {
    expect(lowerInterrupts({ operation: 'interrupt.attach', pin: 4, handler: 'h', mode: 'falling' }).code)
      .toContain('GPIO_INTR_NEGEDGE');
  });
  it('attach with change → GPIO_INTR_ANYEDGE', () => {
    expect(lowerInterrupts({ operation: 'interrupt.attach', pin: 4, handler: 'h', mode: 'change' }).code)
      .toContain('GPIO_INTR_ANYEDGE');
  });
  it('attach with low → GPIO_INTR_LOW_LEVEL', () => {
    expect(lowerInterrupts({ operation: 'interrupt.attach', pin: 4, handler: 'h', mode: 'low' }).code)
      .toContain('GPIO_INTR_LOW_LEVEL');
  });
  it('detach → gpio_isr_handler_remove', () => {
    expect(lowerInterrupts({ operation: 'interrupt.detach', pin: 4 }))
      .toEqual({ code: 'gpio_isr_handler_remove((gpio_num_t)4);' });
  });
  it('unknown interrupt.* op throws', () => {
    expect(() => lowerInterrupts({ operation: 'interrupt.unknown', pin: 4 } as any)).toThrow(/does not yet support/);
  });
});
