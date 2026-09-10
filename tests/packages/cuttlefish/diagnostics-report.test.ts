// ---------------------------------------------------------------------------
// Diagnostics report — the --diagnostics artifacts must describe the program
// the Zephyr-era pipeline actually built: peripherals by board pin name and
// devicetree controller, honest entry points (main, not setup/loop), and
// memory numbers that count source literals only (never rendered C++ text).
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeEach } from 'vitest';
import * as fs from 'node:fs';
import { analyzePeripheralUsage, createEmptyPeripheralUsage } from '../../../packages/cuttlefish/src/ir/peripheral-usage';
import { markHalOpResolved, resetTranspileResolvedHalOps } from '../../../packages/cuttlefish/src/ir/build-ir-state';
import { parsePadFromRouteName } from '../../../packages/cuttlefish/src/board-catalog/dts-reader';
import { GENERATOR_REV, locateZephyrBaseCheap, overlayPathFor, readBoardCatalogOverlayFile, resetBoardCatalogOverlayCache } from '../../../packages/cuttlefish/src/board-catalog/store';
import { buildDiagnosticsReport } from '../../../packages/cuttlefish/src/diagnostics/diagnostics-report';
import { generateMarkdownReport } from '../../../packages/cuttlefish/src/diagnostics/md-writer';
import { buildCallGraph } from '../../../packages/cuttlefish/src/ir/call-graph';
import { generateBoard } from '../../../packages/framework-zephyr/src/boardgen';
import type { ProgramIR } from '../../../packages/cuttlefish/src/api/index.js';
import type { BoardConstants } from '../../../packages/cuttlefish/src/ir/board-resolver.js';

function constantsMap(entries: Record<string, string | number | boolean>): BoardConstants {
  return new Map(Object.entries(entries)) as BoardConstants;
}

function minimalProgram(overrides: Partial<ProgramIR> & { boardConstants?: BoardConstants }): ProgramIR {
  return {
    fileName: 'main.ts',
    imports: [],
    reExports: [],
    structs: [],
    enums: [],
    classes: [],
    typeAliases: [],
    registerClasses: [],
    topLevelStatements: [],
    functions: [],
    boilerplates: [],
    diagnostics: [],
    peripheralUsage: createEmptyPeripheralUsage(),
    interfaces: [],
    namespaces: [],
    ...overrides,
  } as unknown as ProgramIR;
}

describe('parsePadFromRouteName — pad from serial pinctrl route names', () => {
  it('parses STM32 letter-port routes', () => {
    expect(parsePadFromRouteName('usart1_tx_pa9')).toEqual({ role: 'tx', pad: 'PA9' });
    expect(parsePadFromRouteName('i2c1_sda_pb9')).toEqual({ role: 'sda', pad: 'PB9' });
  });

  it('parses ESP32 gpio-pad and nRF port_bit routes', () => {
    expect(parsePadFromRouteName('uart0_tx_gpio43')).toEqual({ role: 'tx', pad: 'GPIO43' });
    expect(parsePadFromRouteName('uart0_tx_p0_6')).toEqual({ role: 'tx', pad: 'P0.06' });
  });

  it('honestly omits pads for group-style names that carry none', () => {
    // nRF board pinctrl groups name the FUNCTION, not the pad — no guess.
    expect(parsePadFromRouteName('uart0_default')).toEqual({ role: undefined, pad: undefined });
    expect(parsePadFromRouteName('uart0_default_tx')).toEqual({ role: 'tx', pad: undefined });
  });
});

describe('analyzePeripheralUsage — zephyr-era op coverage', () => {
  beforeEach(() => {
    resetTranspileResolvedHalOps();
  });

  function halOp(operation: string, fields: Record<string, unknown> = {}): any {
    return { kind: 'hal-op', operation: { operation, ...fields }, returns_value: false };
  }

  it('tracks USB/I2C/UART/WDG ops with instances and board pin names', () => {
    const bc = constantsMap({
      'pins.all.45.number': 45,
      'pins.all.45.name': 'PC13',
      'pins.all.0.number': 0,
      'pins.all.0.name': 'PA0',
    });
    const program = minimalProgram({
      boardConstants: bc,
      topLevelStatements: [
        halOp('usb.begin', { port: 'USB0' }),
        halOp('i2c.reg_write', { bus: 'I2C0', address: 0x44, hz: 0, reg: 0, value: 1 }),
        halOp('uart.poll_write', { port: 'UART0', baud: 115200, data: '' }),
        halOp('wdt.feed'),
        halOp('gpio.configure', { pin: 45, flags: 'GPIO.OUTPUT' }),
      ],
    });

    const usage = analyzePeripheralUsage(program);
    expect(usage.usb).toBe(true);
    expect(usage.usbInstancesUsed.has(0)).toBe(true);
    expect(usage.i2c).toBe(true);
    expect(usage.i2cInstancesUsed.has(0)).toBe(true);
    expect(usage.uart).toBe(true);
    expect(usage.uartInstancesUsed.has(0)).toBe(true);
    expect(usage.wdt).toBe(true);
    // The configured pin lands under its BOARD name, not a D-number.
    expect(usage.pinsUsed.has('PC13')).toBe(true);
    expect(usage.outputPins.has(45)).toBe(true);
  });

  it('counts ops that were inlined to C++ text (the transpile-resolved registry)', () => {
    const bc = constantsMap({
      'pins.all.0.number': 0,
      'pins.all.0.name': 'PA0',
    });
    // adc.read_mv inside a USB0.writeLine template never becomes an IR node —
    // the lowering seam records the op node instead.
    markHalOpResolved({ operation: 'adc.read_mv', pin: 0 } as any);

    const usage = analyzePeripheralUsage(minimalProgram({ boardConstants: bc }));
    expect(usage.adc).toBe(true);
    expect(usage.adcChannelsUsed.has(0)).toBe(true);
    expect(usage.pinsUsed.has('PA0')).toBe(true);
  });

  it('keeps every transpile-resolved op, even same-named ones on different pins', () => {
    // Two inlined reads (e.g. two sensors in one writeLine template) must not
    // overwrite each other — the registry keeps every op node, not one per
    // operation name.
    const bc = constantsMap({
      'pins.all.0.number': 0,
      'pins.all.0.name': 'PA0',
      'pins.all.5.number': 5,
      'pins.all.5.name': 'PA5',
    });
    markHalOpResolved({ operation: 'adc.read_mv', pin: 0 } as any);
    markHalOpResolved({ operation: 'adc.read_mv', pin: 5 } as any);

    const usage = analyzePeripheralUsage(minimalProgram({ boardConstants: bc }));
    expect(usage.adcChannelsUsed.has(0)).toBe(true);
    expect(usage.adcChannelsUsed.has(5)).toBe(true);
    expect(usage.pinsUsed.has('PA0')).toBe(true);
    expect(usage.pinsUsed.has('PA5')).toBe(true);
  });

  it('survives malformed ops without throwing', () => {
    const program = minimalProgram({
      topLevelStatements: [halOp('sensor.fetch', { bus: undefined, busKind: 'i2c', part: 'sht3xd' })],
    });
    expect(() => analyzePeripheralUsage(program)).not.toThrow();
  });

  it('counts ops inside registered callback bodies (Thread/ISR-driven hardware)', () => {
    // Regression: hardware driven ONLY inside a callback (a Thread toggling
    // the LED) never appeared in the pin/peripheral tables — the analyzer
    // walked statements, functions and classes but not registeredCallbacks.
    const bc = constantsMap({
      'pins.all.13.number': 13,
      'pins.all.13.name': 'PC13',
    });
    const program = minimalProgram({
      boardConstants: bc,
      registeredCallbacks: [
        {
          placeholderName: '__CALLBACK_0__',
          callbackIR: {
            kind: 'callback',
            params: [],
            isInterruptHandler: false,
            statements: [
              halOp('gpio.configure', { pin: 13, flags: 'GPIO.OUTPUT' }),
              halOp('gpio.toggle', { pin: 13 }),
            ],
          },
        },
      ],
    } as unknown as Partial<ProgramIR>);

    const usage = analyzePeripheralUsage(program);
    expect(usage.pinsUsed.has('PC13')).toBe(true);
    expect(usage.outputPins.has(13)).toBe(true);
  });
});

describe('buildDiagnosticsReport — peripheral allocation from board facts', () => {
  it('renders UART0 with its devicetree node and harvested pads', () => {
    const bc = constantsMap({
      'zephyr.uart.controllers.0.nodeLabel': 'usart1',
      'zephyr.uart.controllers.0.pads': 'tx=PA9,rx=PA10',
      'zephyr.uart.controllers.0.pinctrl': 'usart1_tx_pa9,usart1_rx_pa10',
      'zephyr.console': 'usart1',
      'pins.all.9.number': 9,
      'pins.all.9.name': 'PA9',
    });
    const program = minimalProgram({
      boardConstants: bc,
      topLevelStatements: [{ kind: 'hal-op', operation: { operation: 'uart.poll_write', port: 'UART0', baud: 115200, data: 'x' }, returns_value: false } as any],
    });
    program.peripheralUsage = analyzePeripheralUsage(program);

    const report = buildDiagnosticsReport({
      entryFile: 'main.ts',
      program,
      diagnostics: [],
      asyncTaskNames: [],
      usesTimers: false,
      target: 'generic',
    });

    // Entry point is the program's top-level code, not setup/loop.
    expect(report.executionFlow.entryPoints).toEqual(['main']);

    const uart = report.pinUsage.peripherals.find((p) => p.type === 'uart');
    expect(uart).toBeDefined();
    expect(uart!.displayName).toContain('UART0');
    expect(uart!.displayName).toContain('usart1');
    expect(uart!.displayName).toContain('console');
    expect(uart!.pins).toEqual(['PA9 (tx)', 'PA10 (rx)']);
  });

  it('counts pin usage against the full board pin list, not an arduino-era cap', () => {
    const entries: Record<string, string | number | boolean> = {};
    for (let i = 0; i < 128; i++) {
      entries[`pins.all.${i}.number`] = i;
      entries[`pins.all.${i}.name`] = `P${i}`;
    }
    const program = minimalProgram({ boardConstants: constantsMap(entries) });
    const report = buildDiagnosticsReport({
      entryFile: 'main.ts',
      program,
      diagnostics: [],
      asyncTaskNames: [],
      usesTimers: false,
      target: 'generic',
    });
    expect(report.pinUsage.summary.totalPins).toBe(128);
    expect(report.pinUsage.summary.usedPins).toBe(0);
  });

  it('does not count rendered C++ text as string literals', () => {
    const program = minimalProgram({
      topLevelStatements: [
        // __EMIT__ args are rendered code, not source literals.
        { kind: 'call', callee: '__EMIT__', args: [{ kind: 'string', value: 'adc_channel_setup(__tc_adc_dev, &__tc_adct0_cfg);' }] } as any,
        // A real source literal counts (length + terminator).
        { kind: 'var_decl', name: 'greet', cppType: 'const char*', initializer: { kind: 'string', value: 'hello' } } as any,
      ],
    });
    const report = buildDiagnosticsReport({
      entryFile: 'main.ts',
      program,
      diagnostics: [],
      asyncTaskNames: [],
      usesTimers: false,
      target: 'generic',
    });
    expect(report.heapEstimate.stringLiterals.map((l) => l.value)).toEqual(['hello']);
    // 'hello' (5+1) plus the global const char* pointer itself (4).
    expect(report.heapEstimate.totalStaticBytes).toBe(10);
  });

  it('counts each part of a string_concat once', () => {
    // Template strings lower to parts-only string_concat nodes — each part
    // must contribute its bytes exactly once.
    const program = minimalProgram({
      topLevelStatements: [
        {
          kind: 'var_decl', name: 's', cppType: 'const char*',
          initializer: {
            kind: 'string_concat',
            parts: [{ kind: 'string', value: 'ab' }, { kind: 'string', value: 'cd' }],
          },
        } as any,
      ],
    });
    const report = buildDiagnosticsReport({
      entryFile: 'main.ts',
      program,
      diagnostics: [],
      asyncTaskNames: [],
      usesTimers: false,
      target: 'generic',
    });
    expect(report.heapEstimate.stringLiterals.map((l) => l.value)).toEqual(['ab', 'cd']);
  });

  it('estimates stack depth from the top-level call path (main = __top_level__)', () => {
    // The call graph keys the program entry `__top_level__`; the report's
    // "main" entry name must walk it or the estimate is vacuously depth 1.
    const span = { filePath: 'main.ts', startLine: 1, startColumn: 0, endLine: 1, endColumn: 0, startOffset: 0, endOffset: 0 };
    const program = minimalProgram({
      topLevelStatements: [{ kind: 'call', callee: 'work', args: [] } as any],
      functions: [
        { originalName: 'work', parameters: [], statements: [{ kind: 'call', callee: 'inner', args: [] } as any], sourceSpan: span },
        { originalName: 'inner', parameters: [], statements: [], sourceSpan: span },
      ] as any,
    });
    const report = buildDiagnosticsReport({
      entryFile: 'main.ts',
      program,
      diagnostics: [],
      asyncTaskNames: [],
      usesTimers: false,
      target: 'generic',
    });
    // main → work → inner
    expect(report.heapEstimate.estimatedStackDepth).toBeGreaterThanOrEqual(3);
  });

  it('keeps used numbers the board module does not export as D-form rows', () => {
    // A gpio.configure on a pad outside the pins.all sweep still drove
    // hardware — it stays in the table (D-form) instead of vanishing.
    const program = minimalProgram({
      topLevelStatements: [
        { kind: 'hal-op', operation: { operation: 'gpio.configure', pin: 9, flags: 'GPIO.OUTPUT' }, returns_value: false } as any,
      ],
    });
    program.peripheralUsage = analyzePeripheralUsage(program);
    const report = buildDiagnosticsReport({
      entryFile: 'main.ts',
      program,
      diagnostics: [],
      asyncTaskNames: [],
      usesTimers: false,
      target: 'generic',
    });
    const row = report.pinUsage.gpio.find((g) => g.pinName === 'D9');
    expect(row).toBeDefined();
    expect(row!.pinNumber).toBe(9);
    expect(row!.mode).toBe('OUTPUT');
  });

  it('marks the main matrix row used even when ISR handler rows share the table', () => {
    // The walk-based match can never hit (dependency tokens vs display
    // names), so the main row must be forced open regardless of how many
    // ISR/async rows sit beside it.
    const span = { filePath: 'main.ts', startLine: 1, startColumn: 0, endLine: 1, endColumn: 0, startOffset: 0, endOffset: 0 };
    const program = minimalProgram({
      topLevelStatements: [
        { kind: 'hal-op', operation: { operation: 'uart.poll_write', port: 'UART0', baud: 115200, data: 'x' }, returns_value: false } as any,
      ],
      functions: [
        { originalName: 'irq_handler', parameters: [], statements: [], sourceSpan: span },
      ] as any,
    });
    program.peripheralUsage = analyzePeripheralUsage(program);
    const report = buildDiagnosticsReport({
      entryFile: 'main.ts',
      program,
      diagnostics: [],
      asyncTaskNames: [],
      usesTimers: false,
      target: 'generic',
    });
    expect(report.executionFlow.isrHandlers).toContain('irq_handler');

    const markdown = generateMarkdownReport(report, buildCallGraph(program));
    const mainRow = markdown.split('\n').find((l) => l.startsWith('| `main()`'));
    expect(mainRow).toBeDefined();
    expect(mainRow).not.toContain('—');
  });

  it('reports ISR handlers by their emitted function names, not placeholders', () => {
    // Regression: the handler table listed __CALLBACK_0__ — an internal
    // placeholder matching nothing in the generated C++ or the call graph.
    // The report must prefer the emit-assigned name and include free
    // functions attached by name (pin.onInterrupt(GPIO.x, isr)).
    const program = minimalProgram({
      registeredCallbacks: [
        {
          placeholderName: '__CALLBACK_0__',
          emittedName: 'main_isr_0',
          callbackIR: { kind: 'callback', params: [], isInterruptHandler: true, statements: [] },
        },
      ],
      isrHandlerFunctions: ['irq_runner'],
    } as unknown as Partial<ProgramIR>);

    const report = buildDiagnosticsReport({
      entryFile: 'main.ts',
      program,
      diagnostics: [],
      asyncTaskNames: [],
      usesTimers: false,
      target: 'generic',
    });
    expect(report.executionFlow.isrHandlers).toContain('main_isr_0');
    expect(report.executionFlow.isrHandlers).not.toContain('__CALLBACK_0__');
    expect(report.executionFlow.isrHandlers).toContain('irq_runner');
  });
});

describe('generated board facts — serial pads reach the board constants', () => {
  // The committed fixture overlay predates the serial-bus pinctrl harvest
  // (rev 32) by design — regenerating it is a separate fact-audit. These
  // assertions need current-walker facts, so they pin the REAL machine
  // overlay for the duration (the sanctioned env override, as in
  // board-catalog-sync.test.ts) and skip unless the machine overlay is at
  // the CURRENT generator rev — generateBoard loads whatever file sits at
  // the path, so a stale overlay would fail the pads assertions below
  // instead of skipping.
  const realTree = locateZephyrBaseCheap();
  const realOverlayPath = realTree ? overlayPathFor(realTree) : undefined;
  const realOverlay = realTree && realOverlayPath && fs.existsSync(realOverlayPath)
    ? readBoardCatalogOverlayFile(realOverlayPath)
    : undefined;
  const hasRealOverlay = (realOverlay?.generatorRev ?? 0) === GENERATOR_REV;

  // Swap in the real machine overlay for one test body; restore the pinned
  // fixture env afterwards.
  const withRealOverlay = (fn: () => void): void => {
    const saved = process.env.TYPECAD_HAL_BOARD_CATALOG;
    process.env.TYPECAD_HAL_BOARD_CATALOG = realOverlayPath!;
    resetBoardCatalogOverlayCache();
    try {
      fn();
    } finally {
      if (saved === undefined) delete process.env.TYPECAD_HAL_BOARD_CATALOG;
      else process.env.TYPECAD_HAL_BOARD_CATALOG = saved;
      resetBoardCatalogOverlayCache();
    }
  };

  const generatedConstants = (): Record<string, string | number | boolean> =>
    JSON.parse(generateBoard('blackpill_f401cc/stm32f401xc').boardJson).constants as Record<string, string | number | boolean>;

  it.skipIf(!hasRealOverlay)('carries the usart1 pads the blackpill DTS wires', () => {
    withRealOverlay(() => {
      const constants = generatedConstants();
      expect(constants['zephyr.uart.controllers.0.nodeLabel']).toBe('usart1');
      expect(constants['zephyr.uart.controllers.0.pads']).toBe('tx=PA9,rx=PA10');
      expect(constants['pins.uart']).toBe('0:tx=PA9,rx=PA10');
    });
  });

  it.skipIf(!hasRealOverlay)('carries the i2c1/spi1 pad maps for the resource-conflict checker', () => {
    withRealOverlay(() => {
      const constants = generatedConstants();
      expect(constants['pins.i2c']).toBe('0:scl=PB8,sda=PB9');
      expect(constants['pins.spi']).toBe('0:sck=PA5,nss=PA4,miso=PA6,mosi=PA7');
    });
  });

  it.skipIf(!hasRealOverlay)('exposes the console controller and flash size for the report header', () => {
    withRealOverlay(() => {
      const constants = generatedConstants();
      expect(constants['zephyr.console']).toBe('usart1');
      expect(constants['mcu']).toBe('stm32f401xc');
      expect(constants['memory.flash']).toBe(256 * 1024);
    });
  });
});
