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

  it('matches resolved hal-op payloads (port/bus identity + timing ops)', () => {
    // Real ISR bodies hold structured hal-op statements after HAL resolution,
    // not callee-shaped calls. The analyzer must map the op name (timing.*)
    // and the payload's peripheral identity fields (port/bus) onto the keys.
    const program = {
      topLevelStatements: [],
      functions: [],
      classes: [],
      registeredCallbacks: [
        {
          callbackIR: {
            isInterruptHandler: true,
            statements: [
              { kind: 'hal-op', operation: { operation: 'timing.sleep', ms: 100 } },
              { kind: 'hal-op', operation: { operation: 'timing.busy_wait_us', us: 50 } },
              { kind: 'hal-op', operation: { operation: 'uart.poll_write', port: 'UART0', data: '"x"' } },
              { kind: 'hal-op', operation: { operation: 'i2c.reg_write', bus: 'I2C0', address: 32 } },
              { kind: 'hal-op', operation: { operation: 'spi.transceive', bus: 'SPI0' } },
            ],
          },
        },
      ],
    } as unknown as ProgramIR;
    const diagnostics = analyzeInterruptSafety(program, {} as never, ops);
    const messages = diagnostics.map((d) => d.message).join('\n');
    expect(messages).toContain('k_msleep');
    expect(messages).toContain('busy-waits');
    expect(messages).toContain('UART');
    expect(messages).toContain('I2C');
    expect(messages).toContain('SPI');
    expect(diagnostics.every((d) => d.code === 'interrupt-unsafe-operation')).toBe(true);
  });

  it('reports each unsafe operation once per ISR run (no per-occurrence spam)', () => {
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
              { kind: 'call', callee: 'delay' },
            ],
          },
        },
      ],
    } as unknown as ProgramIR;
    const diagnostics = analyzeInterruptSafety(program, {} as never, ops);
    expect(diagnostics).toHaveLength(1);
  });

  it('scans helper functions called from an ISR (transitive unsafe ops)', () => {
    const program = {
      topLevelStatements: [],
      functions: [
        { originalName: 'logStuff', statements: [{ kind: 'call', callee: 'UART0.write' }] },
      ],
      classes: [],
      registeredCallbacks: [
        {
          callbackIR: {
            isInterruptHandler: true,
            statements: [{ kind: 'call', callee: 'logStuff' }],
          },
        },
      ],
    } as unknown as ProgramIR;
    const diagnostics = analyzeInterruptSafety(program, {} as never, ops);
    const messages = diagnostics.map((d) => d.message).join('\n');
    expect(messages).toContain('UART0.write');
  });
});

// ── End-to-end: the whole pipeline (build + analysis + emit) ────────────────
//
// The unit tests above feed hand-built IR; these run the real transpiler so
// the hal-op shapes and named-handler plumbing are exercised as shipped.

import { transpileZephyrStrategy, expectCppContains } from '../../setup';

describe('ISR safety end-to-end (real pipeline)', () => {
  it('promotes ISR-written/main-read globals to volatile (inline handler)', () => {
    const result = transpileZephyrStrategy(`
      import { GPIO } from '@typecad/hal';
      let irq = 0;
      const pin = new GPIO(0, GPIO.INPUT);
      pin.onInterrupt(GPIO.INT_EDGE_RISING, (): void => { irq++; });
      while (true) { if (irq > 0) { } }
    `);
    expectCppContains(result, ['volatile int irq = 0;']);
    expect(result.diagnostics.some((d) => d.code === 'volatile-isr-shared')).toBe(true);
  });

  it('promotes volatile for NAMED function handlers (no callback IR node)', () => {
    // Regression: a named handler lowered to a bare C function reference, so
    // no callback IR node existed and the analysis never saw its body.
    const result = transpileZephyrStrategy(`
      import { GPIO } from '@typecad/hal';
      let irq = 0;
      function irq_runner() {
        irq++;
      }
      const pin = new GPIO(0, GPIO.INPUT);
      pin.onInterrupt(GPIO.INT_EDGE_RISING, irq_runner);
      while (true) { if (irq > 0) { } }
    `);
    expectCppContains(result, ['volatile int irq = 0;']);
    expect(result.diagnostics.some((d) => d.code === 'volatile-isr-shared')).toBe(true);
    expect(result.diagnostics.some((d) => d.code === 'interrupt-unsafe-operation')).toBe(false);
  });

  it('does NOT promote a global the main code never reads', () => {
    const result = transpileZephyrStrategy(`
      import { GPIO } from '@typecad/hal';
      let irq = 0;
      const pin = new GPIO(0, GPIO.INPUT);
      pin.onInterrupt(GPIO.INT_EDGE_RISING, (): void => { irq++; });
      while (true) { }
    `);
    expect(result.cpp).not.toContain('volatile int irq');
    expect(result.diagnostics.some((d) => d.code === 'volatile-isr-shared')).toBe(false);
  });

  it('sees reads fused into emitted formatting (writeLine argument)', () => {
    // "irq=" + irq lowers to a snprintf C fragment — the identifier exists
    // only inside the emitted string, invisible to the expression walk.
    const result = transpileZephyrStrategy(`
      import { GPIO, UART0 } from '@typecad/hal';
      let irq = 0;
      const pin = new GPIO(0, GPIO.INPUT);
      pin.onInterrupt(GPIO.INT_EDGE_RISING, (): void => { irq++; });
      while (true) { UART0.writeLine("irq=" + irq); }
    `);
    expectCppContains(result, ['volatile int irq = 0;']);
    expect(result.diagnostics.some((d) => d.code === 'volatile-isr-shared')).toBe(true);
  });

  it('flags UART output inside an inline ISR (hal-op payload match)', () => {
    // Regression: UART0.write resolved to a uart.poll_write hal-op, which no
    // unsafe-op key matched — the strategy's UART entry never fired.
    const result = transpileZephyrStrategy(`
      import { GPIO, UART0 } from '@typecad/hal';
      const pin = new GPIO(0, GPIO.INPUT);
      pin.onInterrupt(GPIO.INT_EDGE_RISING, (): void => { UART0.write('!'); });
      while (true) { }
    `);
    const diag = result.diagnostics.find((d) => d.code === 'interrupt-unsafe-operation');
    expect(diag).toBeDefined();
    expect(diag!.message).toContain('uart_poll_out');
    expect(diag!.severity).toBe('info');
  });

  it('flags UART output inside a NAMED handler body', () => {
    const result = transpileZephyrStrategy(`
      import { GPIO, UART0 } from '@typecad/hal';
      function irq_runner() {
        UART0.write('!');
      }
      const pin = new GPIO(0, GPIO.INPUT);
      pin.onInterrupt(GPIO.INT_EDGE_RISING, irq_runner);
      while (true) { }
    `);
    const diag = result.diagnostics.find((d) => d.code === 'interrupt-unsafe-operation');
    expect(diag).toBeDefined();
    expect(diag!.message).toContain('uart_poll_out');
  });

  it('flags Time.sleep inside an ISR (k_msleep is illegal in interrupt context)', () => {
    // Regression: timing.sleep hal-ops had no mapping to the delay key.
    const result = transpileZephyrStrategy(`
      import { GPIO, Time } from '@typecad/hal';
      const pin = new GPIO(0, GPIO.INPUT);
      pin.onInterrupt(GPIO.INT_EDGE_RISING, (): void => { Time.sleep(100); });
      while (true) { }
    `);
    const diag = result.diagnostics.find((d) => d.code === 'interrupt-unsafe-operation');
    expect(diag).toBeDefined();
    expect(diag!.severity).toBe('warning');
    expect(diag!.message).toContain('k_msleep');
  });

  it('flags I2C traffic inside an ISR (bus identity from the op payload)', () => {
    const result = transpileZephyrStrategy(`
      import { GPIO, I2C0, I2CTarget } from '@typecad/hal';
      const sensor = new I2CTarget(I2C0, 0x3c);
      const pin = new GPIO(0, GPIO.INPUT);
      pin.onInterrupt(GPIO.INT_EDGE_RISING, (): void => { sensor.write([0x01]); });
      while (true) { }
    `);
    const diag = result.diagnostics.find((d) => d.code === 'interrupt-unsafe-operation');
    expect(diag).toBeDefined();
    expect(diag!.severity).toBe('warning');
  });

  it('warns when a pin gets two interrupt attaches (second replaces the first)', () => {
    const result = transpileZephyrStrategy(`
      import { GPIO } from '@typecad/hal';
      const pin = new GPIO(0, GPIO.INPUT);
      pin.onInterrupt(GPIO.INT_EDGE_RISING, (): void => { });
      pin.onInterrupt(GPIO.INT_EDGE_FALLING, (): void => { });
      while (true) { }
    `);
    const diag = result.diagnostics.find((d) => d.code === 'interrupt-duplicate-handler');
    expect(diag).toBeDefined();
    expect(diag!.severity).toBe('warning');
  });

  it('does not warn on the attach/detach/attach re-attach pattern', () => {
    const result = transpileZephyrStrategy(`
      import { GPIO } from '@typecad/hal';
      const pin = new GPIO(0, GPIO.INPUT);
      pin.onInterrupt(GPIO.INT_EDGE_RISING, (): void => { });
      pin.offInterrupt();
      pin.onInterrupt(GPIO.INT_EDGE_FALLING, (): void => { });
      while (true) { }
    `);
    expect(result.diagnostics.some((d) => d.code === 'interrupt-duplicate-handler')).toBe(false);
  });

  it('warns when a named handler is also called from main-thread code', () => {
    const result = transpileZephyrStrategy(`
      import { GPIO } from '@typecad/hal';
      let irq = 0;
      function irq_runner() {
        irq++;
      }
      const pin = new GPIO(0, GPIO.INPUT);
      pin.onInterrupt(GPIO.INT_EDGE_RISING, irq_runner);
      irq_runner();
      while (true) { }
    `);
    const diag = result.diagnostics.find((d) => d.code === 'reentrancy-risk');
    expect(diag).toBeDefined();
    expect(diag!.message).toContain('irq_runner');
  });
});
