import { describe, it, expect } from 'vitest';
import { ZephyrStrategy } from '../../../packages/framework-zephyr/src/strategy';
import { analyzeInterruptSafety } from '../../../packages/cuttlefish/src/ir/interrupt-analysis';
import type { ProgramIR } from '../../../packages/cuttlefish/src/api/index';

describe('ZephyrStrategy.isrUnsafeOperations', () => {
  const strategy = new ZephyrStrategy();
  const ops = strategy.isrUnsafeOperations();

  it('flags the sleeping/bus operations the analyzer matches at IR level', () => {
    // Keys mirror the callee names interrupt-analysis checks (the analyzer
    // maps timing.delay hal-ops back to the bare 'delay' name itself).
    for (const key of ['delay', 'delayMicroseconds', 'I2C0', 'I2C1', 'SPI0', 'SPI1', 'UART0', 'UART1']) {
      expect(ops.get(key), `missing ${key}`).toBeDefined();
    }
  });

  it('explains the Zephyr constraint (ISRs must not sleep or take driver locks)', () => {
    expect(ops.get('delay')!.severity).toBe('warning');
    expect(ops.get('delay')!.reason).toContain('k_msleep');
    expect(ops.get('I2C0')!.severity).toBe('warning');
  });

  it('feeds analyzeInterruptSafety for calls inside ISR callbacks', () => {
    // Minimal IR: an ISR callback containing a delay() call statement. The
    // analyzer flags it via the strategy-supplied map.
    const program = {
      topLevelStatements: [],
      functions: [],
      classes: [],
      registeredCallbacks: [
        {
          callbackIR: {
            isInterruptHandler: true,
            statements: [
              { kind: 'call', callee: 'delay' },
              { kind: 'call', callee: 'I2C0.write' },
              { kind: 'call', callee: 'UART0.writeLine' },
            ],
          },
        },
      ],
    } as unknown as ProgramIR;
    const diagnostics = analyzeInterruptSafety(program, {} as never, ops);
    const messages = diagnostics.map((d) => d.message).join('\n');
    expect(messages).toContain('delay()');
    expect(messages).toContain('I2C0.write');
    expect(messages).toContain('UART0.writeLine');
    expect(diagnostics.every((d) => d.code === 'interrupt-unsafe-operation')).toBe(true);
  });
});
