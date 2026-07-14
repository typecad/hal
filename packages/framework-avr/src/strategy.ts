// ---------------------------------------------------------------------------
// @typecad/framework-avr — Native AVR platform strategy
//
// This strategy generates direct AVR register access instead of Arduino
// framework function calls. For example:
//   D13.high()  →  PORTB |= (1 << PB5)
//   A0.read()   →  ADC register operations
// ---------------------------------------------------------------------------

import { ArduinoStrategy } from '@typecad/framework-arduino';
import type { RuntimePolyfillIR, ProgramIR, PlatformContext, HALOpIR, StatementIR, Diagnostic } from '@typecad/cuttlefish/api/shared';
import {
  getPinInfo,
  getPinBitMask,
  getADCChannel,
  getPWMInfo,
  getInterruptInfo,
} from './registers.js';
import { activeChip, setActiveChip, ATMEGA328P } from './chips/index.js';
import type { AVRChipDescriptor } from './chips/types.js';
import { resolveAvrProfile } from './profile.js';
import type { ResolvedAvrProfile } from './profile.js';

// ---------------------------------------------------------------------------
// Native AVR code generation functions
// ---------------------------------------------------------------------------

/**
 * Generate native pinMode code with pre-computed bit mask.
 *
 * Accepts the lowercase canonical mode strings carried by HALOpIR
 * ("output" | "input" | "input_pullup" | "input_pulldown").
 */
function nativePinMode(pin: number, mode: string): string {
  const info = getPinInfo(pin);
  if (!info) return `/* invalid pin ${pin} */`;

  const { ddr, port } = info;
  const mask = getPinBitMask(pin);  // Pre-computed hex constant

  if (mode === 'output') {
    return `${ddr} |= ${mask}`;
  } else if (mode === 'input_pullup') {
    return `${ddr} &= ~${mask}; ${port} |= ${mask}`;
  } else if (mode === 'input_pulldown') {
    // AVR has no hardware pulldown — fall back to floating input
    return `${ddr} &= ~${mask}; ${port} &= ~${mask}`;
  } else { // "input"
    return `${ddr} &= ~${mask}; ${port} &= ~${mask}`;
  }
}

/**
 * Generate native digitalWrite code with pre-computed bit mask.
 *
 * Accepts literal HIGH/LOW or a runtime expression. For runtime values,
 * emits a branchless assignment (the classic AVR idiom) rather than a
 * side-effecting ternary, which would be a non-lvalue expression.
 */
function nativeDigitalWrite(pin: number, value: string): string {
  const info = getPinInfo(pin);
  if (!info) return `/* invalid pin ${pin} */`;

  const { port } = info;
  const mask = getPinBitMask(pin);  // Pre-computed hex constant

  if (value === 'HIGH' || value === '1' || value === 'true') {
    return `${port} |= ${mask}`;
  } else if (value === 'LOW' || value === '0' || value === 'false') {
    return `${port} &= ~${mask}`;
  } else {
    // Dynamic runtime expression — branchless read-modify-write
    return `${port} = (${port} & ~${mask}) | ((${value}) ? ${mask} : 0)`;
  }
}

/**
 * Generate native digitalRead expression with pre-computed bit mask.
 */
function nativeDigitalRead(pin: number): string {
  const info = getPinInfo(pin);
  if (!info) return `0 /* invalid pin ${pin} */`;

  const { pinReg } = info;
  const mask = getPinBitMask(pin);  // Pre-computed hex constant
  return `((${pinReg} & ${mask}) ? 1 : 0)`;
}

/**
 * Generate native analogRead expression (statement expression).
 * Optimized version: assumes ADC is already initialized via _init_adc() in setup().
 */
function nativeAnalogRead(pin: number): string {
  const channel = getADCChannel(pin);
  if (channel === null) return `0 /* invalid analog pin ${pin} */`;

  // Use GCC statement expression for multi-step ADC read
  // ADC is initialized once in setup() via _init_adc() - no runtime check needed
  return `({ ` +
    `ADMUX = ${activeChip.adc.referenceBits} | ${channel}; ` +  // reference + channel
    `ADCSRA |= (1 << ADSC); ` +               // Start conversion
    `while (ADCSRA & (1 << ADSC)); ` +        // Wait for completion
    `ADC; ` +                                  // Return result
  `})`;
}

/**
 * Generate native analogWrite (PWM) code.
 * Optimized: Only sets duty cycle. Timer is initialized once in setup via _init_pwm_timerX().
 */
function nativeAnalogWrite(pin: number, value: string): string {
  const pwm = getPWMInfo(pin);
  if (!pwm) return `/* analogWrite: pin ${pin} does not support PWM */`;
  
  const { ocr } = pwm;
  // Timer is already initialized - just set duty cycle
  return `${ocr} = ${value}`;
}

// ---------------------------------------------------------------------------
// NativeAVRStrategy class
// ---------------------------------------------------------------------------

/**
 * Platform strategy for native AVR code generation.
 *
 * Generates direct AVR register access instead of Arduino framework calls.
 * This strategy overrides the default "arduino" strategy to generate native code.
 */
export class NativeAVRStrategy extends ArduinoStrategy {
  // Override the ID to replace the default arduino strategy
  override readonly id = "arduino";

  /**
   * Cached AVR profile. Resolved lazily from the build target (FQBN) on the
   * first emit call, so the chip is selected from the user's config rather
   * than hardcoded. Mirrors ArduinoStrategy's _cachedProfile pattern but uses
   * distinct field names to avoid shadowing the parent's private cache.
   */
  private _avrProfile: ResolvedAvrProfile | null = null;
  private _avrProfileKey: string | null = null;

  /**
   * Construct with an explicit chip (default ATmega328P). When the strategy
   * is loaded via the framework-package loader (no constructor args), the
   * chip is instead resolved lazily from ctx.frameworkData.buildTarget on the
   * first emit call — see resolveAvrProfileCached().
   */
  constructor(chip?: AVRChipDescriptor) {
    super();
    if (chip) {
      setActiveChip(chip);
    }
  }

  /**
   * Resolve (and cache by buildTarget) the AVR profile. Selects the chip
   * descriptor from the FQBN board segment, activates it, and collects
   * diagnostics. The test harness reuses one strategy instance across files,
   * so caching by buildTarget avoids re-resolving and keeps the active chip
   * stable for a given transpile.
   */
  private resolveAvrProfileCached(program?: ProgramIR, ctx?: PlatformContext): ResolvedAvrProfile {
    const key = (ctx?.frameworkData as { buildTarget?: string } | undefined)?.buildTarget ?? 'default';
    if (this._avrProfile && this._avrProfileKey === key) {
      return this._avrProfile;
    }
    this._avrProfile = resolveAvrProfile(program, ctx);
    this._avrProfileKey = key;
    return this._avrProfile;
  }

  /** Reset both the AVR and parent profile caches. Intended for test isolation. */
  override clearProfileCache(): void {
    super.clearProfileCache();
    this._avrProfile = null;
    this._avrProfileKey = null;
  }

  // ── Includes ────────────────────────────────────────────────────────────

  override forcedIncludes(program?: ProgramIR, ctx?: PlatformContext): string[] {
    // Only avr/io.h here - util/delay.h needs F_CPU defined first (in shimLines)
    return this.resolveAvrProfileCached(program, ctx).forcedIncludes;
  }

  /**
   * Surface AVR-specific diagnostics (invalid pins, unsupported PWM) in
   * addition to the parent's architecture-gated diagnostics (heap/vector).
   * Snapshots the profile diagnostics first so the cached array is not
   * mutated across transpilations.
   */
  override profileDiagnostics(program: ProgramIR, ctx?: PlatformContext): Diagnostic[] {
    const avrDiags = [...this.resolveAvrProfileCached(program, ctx).diagnostics];
    const parentDiags = super.profileDiagnostics(program, ctx);
    return [...parentDiags, ...avrDiags];
  }

  // ── Polyfill overrides ──────────────────────────────────────────────────

  /**
   * This strategy provides native implementations for console.log.
   * The emitter will skip emitting the global console polyfill.
   */
  override nativePolyfills(): Set<string> {
    return new Set(['console']);
  }

  /**
   * Generate native console polyfill using UART functions.
   */
  override generateNativePolyfills(program?: ProgramIR, _ctx?: PlatformContext): RuntimePolyfillIR[] {
    const usesConsole = this.detectConsoleUsage(program);
    if (!usesConsole) {
      return [];
    }

    return [{
      id: 'console',
      kind: 'polyfill',
      domain: 'arduino',
      requiredIncludes: [],
      forwardDeclarations: [],
      helperStructs: [],
      helperFunctions: [
        `// Native console.log using UART (no Arduino Serial dependency)`,
        `inline void console_log(const char* msg) { _uart_println(msg); }`,
        `inline void console_log(int val) { _uart_println_long(val); }`,
        `inline void console_log(unsigned int val) { _uart_println_long(val); }`,
        `inline void console_log(long val) { _uart_println_long(val); }`,
        `inline void console_log(unsigned long val) { _uart_println_long(val); }`,
        `inline void console_log(float val) { _uart_print_float(val); _uart_write('\\r'); _uart_write('\\n'); }`,
        `inline void console_log(double val) { _uart_print_float(val); _uart_write('\\r'); _uart_write('\\n'); }`,
        `inline void console_log(bool val) { _uart_println(val ? "true" : "false"); }`,
        ``,
        `// Native console.error using UART`,
        `inline void console_error(const char* msg) { _uart_print("[ERROR] "); _uart_println(msg); }`,
        `inline void console_error(int val) { _uart_print("[ERROR] "); _uart_println_long(val); }`,
        `inline void console_error(unsigned int val) { _uart_print("[ERROR] "); _uart_println_long(val); }`,
        `inline void console_error(long val) { _uart_print("[ERROR] "); _uart_println_long(val); }`,
        `inline void console_error(unsigned long val) { _uart_print("[ERROR] "); _uart_println_long(val); }`,
        `inline void console_error(float val) { _uart_print("[ERROR] "); _uart_print_float(val); _uart_write('\\r'); _uart_write('\\n'); }`,
        `inline void console_error(double val) { _uart_print("[ERROR] "); _uart_print_float(val); _uart_write('\\r'); _uart_write('\\n'); }`,
        ``,
        `// Native console.warn using UART`,
        `inline void console_warn(const char* msg) { _uart_print("[WARN] "); _uart_println(msg); }`,
        `inline void console_warn(int val) { _uart_print("[WARN] "); _uart_println_long(val); }`,
        `inline void console_warn(unsigned int val) { _uart_print("[WARN] "); _uart_println_long(val); }`,
        `inline void console_warn(long val) { _uart_print("[WARN] "); _uart_println_long(val); }`,
        `inline void console_warn(unsigned long val) { _uart_print("[WARN] "); _uart_println_long(val); }`,
        `inline void console_warn(float val) { _uart_print("[WARN] "); _uart_print_float(val); _uart_write('\\r'); _uart_write('\\n'); }`,
        `inline void console_warn(double val) { _uart_print("[WARN] "); _uart_print_float(val); _uart_write('\\r'); _uart_write('\\n'); }`,
      ],
      shimMacros: [
        `#define console_log(...) console_log(__VA_ARGS__)`,
        `#define console_error(...) console_error(__VA_ARGS__)`,
        `#define console_warn(...) console_warn(__VA_ARGS__)`,
      ],
      dependencies: [],
    }];
  }

  /**
   * Detect if console is used in the program.
   */
  private detectConsoleUsage(program?: ProgramIR): boolean {
    if (!program) return false;

    for (const fn of program.functions ?? []) {
      for (const stmt of fn.statements ?? []) {
        if (this.statementUsesConsole(stmt)) {
          return true;
        }
      }
    }

    for (const stmt of program.topLevelStatements ?? []) {
      if (this.statementUsesConsole(stmt)) {
        return true;
      }
    }

    return false;
  }

  /**
   * Check if a statement uses console.
   */
  private statementUsesConsole(stmt: StatementIR): boolean {
    if (!stmt) return false;
    if (stmt.kind === 'call') {
      const callee = stmt.callee ?? '';
      if (callee.startsWith('console.')) {
        return true;
      }
      if (callee === '_uart_println' || callee === '_uart_print' ||
          callee === '_uart_println_long' || callee === '_uart_print_float') {
        return true;
      }
    }
    const nested = (stmt as { statements?: StatementIR[] }).statements;
    if (nested) {
      for (const child of nested) {
        if (this.statementUsesConsole(child)) {
          return true;
        }
      }
    }
    return false;
  }

  override shimLines(program?: ProgramIR, ctx?: PlatformContext): string[] {
    const lines: string[] = [];
    
    // F_CPU must be defined before including util/delay.h
    const fcpuLiteral = `${activeChip.fcpu}UL`;
    lines.push(
      '#ifndef F_CPU',
      `#define F_CPU ${fcpuLiteral}`,
      '#endif',
      '#include <util/delay.h>',
      '#include <avr/interrupt.h>',
      ''
    );
    
    const usage = program?.peripheralUsage;
    const usesADC = usage?.adc ?? false;
    const usesPWM = usage?.pwm ?? false;
    const usesExternalInterrupts = usage?.externalInterrupts ?? false;
    const usesUART = true;
    const pwmPinsUsed = usage?.pwmPinsUsed ?? new Set<number>();
    
    // UART initialization and helper functions
    if (usesUART) {
      lines.push(
        '// UART initialization (native AVR USART0)',
        'static inline void _uart_init(unsigned long baud) {',
        '  unsigned int ubrr = (F_CPU / 16 / baud - 1);',
        '  UBRR0H = (unsigned char)(ubrr >> 8);',
        '  UBRR0L = (unsigned char)ubrr;',
        '  UCSR0B = (1 << RXEN0) | (1 << TXEN0);',
        '  UCSR0C = (1 << UCSZ01) | (1 << UCSZ00);  // 8N1',
        '}',
        '',
        'static inline int _uart_available() {',
        '  return (UCSR0A & (1 << RXC0)) ? 1 : 0;',
        '}',
        '',
        'static inline int _uart_read() {',
        '  while (!(UCSR0A & (1 << RXC0)));',
        '  return UDR0;',
        '}',
        '',
        'static inline void _uart_write(unsigned char data) {',
        '  while (!(UCSR0A & (1 << UDRE0)));',
        '  UDR0 = data;',
        '}',
        '',
        'static inline void _uart_print(const char* str) {',
        '  while (*str) _uart_write(*str++);',
        '}',
        '',
        'static inline void _uart_println(const char* str) {',
        '  _uart_print(str);',
        '  _uart_write(\'\\r\');',
        '  _uart_write(\'\\n\');',
        '}',
        '',
        'static inline void _uart_print_long(long num) {',
        '  char buf[12];',
        '  ltoa(num, buf, 10);',
        '  _uart_print(buf);',
        '}',
        '',
        'static inline void _uart_println_long(long num) {',
        '  _uart_print_long(num);',
        '  _uart_write(\'\\r\');',
        '  _uart_write(\'\\n\');',
        '}',
        '',
        'static inline void _uart_print_float(float num) {',
        '  if (num < 0) { _uart_write(\'-\'); num = -num; }',
        '  long integer = (long)num;',
        '  long decimal = (long)((num - integer) * 100);',
        '  _uart_print_long(integer);',
        '  _uart_write(\'.\');',
        '  if (decimal < 10) _uart_write(\'0\');',
        '  _uart_print_long(decimal);',
        '}',
        ''
      );
    }
    
    // ADC initialization
    if (usesADC) {
      lines.push(
        '// ADC initialization',
        'static inline void _init_adc() {',
        `  ADCSRA = (1 << ADEN) | ${activeChip.adc.prescalerBits};`,
        '}',
        ''
      );
    }
    
    // PWM timer initialization — one helper per timer actually used, with the
    // register setup sourced from the active chip descriptor's initCode.
    if (usesPWM && pwmPinsUsed.size > 0) {
      const timersNeeded = new Set<string>();
      for (const pin of pwmPinsUsed) {
        const pwm = getPWMInfo(pin);
        if (pwm) {
          timersNeeded.add(pwm.timerId);
        }
      }

      lines.push('// PWM timer initialization');

      for (const timerId of timersNeeded) {
        const timer = activeChip.timers[timerId];
        if (!timer) continue;
        lines.push(
          `static inline void _init_pwm_${timerId}() {`,
          `  ${timer.initCode}`,
          '}',
          ''
        );
      }
    }
    
    // Native delay functions
    lines.push(
      'static inline void _native_delay_ms(unsigned long ms) { while (ms--) _delay_ms(1); }',
      'static inline void _native_delay_us(unsigned int us) { while (us--) _delay_us(1); }',
      ''
    );
    
    // Optimized map() function
    lines.push(
      'static inline long _native_map(long x, long in_min, long in_max, long out_min, long out_max) {',
      '  if (in_min == 0 && out_min == 0) {',
      '    long in_range = in_max - in_min + 1;',
      '    long out_range = out_max - out_min + 1;',
      '    if (in_range == 1024 && out_range == 256) return x >> 2;',
      '    if (in_range == 1024 && out_range == 128) return x >> 3;',
      '    if (in_range == 256 && out_range == 1024) { long r = x << 2; return r > 1023 ? 1023 : r; }',
      '  }',
      '  return (x - in_min) * (out_max - out_min) / (in_max - in_min) + out_min;',
      '}',
      ''
    );
    
    lines.push(
      'static inline long _native_constrain(long x, long a, long b) {',
      '  return (x < a) ? a : ((x > b) ? b : x);',
      '}',
      ''
    );
    
    // External interrupt handlers
    if (usesExternalInterrupts) {
      lines.push(
        'static volatile void (*_int0_handler)(void) = 0;',
        'static volatile void (*_int1_handler)(void) = 0;',
        '',
        'ISR(INT0_vect) { if (_int0_handler) _int0_handler(); }',
        '',
        'ISR(INT1_vect) { if (_int1_handler) _int1_handler(); }',
        ''
      );
    }

    // Merge in the parent Arduino shims. The AVR block above is emitted first
    // (it defines F_CPU and the AVR peripheral helpers); the parent then
    // contributes the conditional helpers its emit path also depends on —
    // CUTTLEFISH_UNDEFINED / cuttlefish_nullish (for `undefined`/`??`),
    // PinGroup, async runtime, string buffer, etc. Without this delegation,
    // any program using `undefined` or `??` fails to compile because the
    // transpiler emits references to symbols this override never defines.
    if (program && ctx) {
      lines.push(...super.shimLines(program, ctx));
    }

    return lines;
  }
  
  /**
   * Generate setup initialization code based on peripheral usage.
   */
  override setupInitCode(program?: ProgramIR, _ctx?: PlatformContext): string[] {
    const lines: string[] = [];

    lines.push(`_uart_init(${activeChip.uart.defaultBaud})`);

    const usage = program?.peripheralUsage;
    const pwmPinsUsed: Set<number> = usage?.pwmPinsUsed ?? new Set<number>();
    const outputPins: Set<number> = usage?.outputPins ?? new Set<number>();
    const inputPullupPins: Set<number> = usage?.inputPullupPins ?? new Set<number>();
    const inputPins: Set<number> = usage?.inputPins ?? new Set<number>();

    // Batch pin mode configuration by port. Resolve each pin's register info
    // once (the previous implementation looked it up three times per pin).
    const portBatches = new Map<string, { outputs: number[], inputs: number[], pullups: number[] }>();

    const batchFor = (pin: number, bucket: 'outputs' | 'inputs' | 'pullups') => {
      const info = getPinInfo(pin);
      if (!info) return;
      const key = `${info.ddr}:${info.port}`;
      let batch = portBatches.get(key);
      if (!batch) { batch = { outputs: [], inputs: [], pullups: [] }; portBatches.set(key, batch); }
      batch[bucket].push(pin);
    };

    for (const pin of outputPins) batchFor(pin, 'outputs');
    for (const pin of inputPullupPins) batchFor(pin, 'pullups');
    for (const pin of inputPins) batchFor(pin, 'inputs');
    
    for (const [key, pins] of portBatches) {
      const [ddr, port] = key.split(':');
      
      if (pins.outputs.length > 0) {
        const mask = pins.outputs.map(p => getPinBitMask(p)).join(' | ');
        const pinList = pins.outputs.map(p => `D${p}`).join(', ');
        lines.push(`${ddr} |= ${mask};  // ${pinList} as outputs`);
      }
      
      if (pins.pullups.length > 0) {
        const ddrMask = pins.pullups.map(p => getPinBitMask(p)).join(' | ');
        const portMask = pins.pullups.map(p => getPinBitMask(p)).join(' | ');
        const pinList = pins.pullups.map(p => `D${p}`).join(', ');
        lines.push(`${ddr} &= ~(${ddrMask});  // ${pinList} as inputs`);
        lines.push(`${port} |= ${portMask};  // ${pinList} pullup enabled`);
      }
      
      if (pins.inputs.length > 0) {
        const ddrMask = pins.inputs.map(p => getPinBitMask(p)).join(' | ');
        const portMask = pins.inputs.map(p => getPinBitMask(p)).join(' | ');
        const pinList = pins.inputs.map(p => `D${p}`).join(', ');
        lines.push(`${ddr} &= ~(${ddrMask});  // ${pinList} as inputs`);
        lines.push(`${port} &= ~(${portMask});  // ${pinList} no pullup`);
      }
    }
    
    if (usage?.adc) {
      lines.push('_init_adc()');
    }
    
    if (usage?.pwm && pwmPinsUsed.size > 0) {
      const timersNeeded = new Set<string>();
      const pinsByTimer = new Map<string, number[]>();
      
      for (const pin of pwmPinsUsed) {
        const pwm = getPWMInfo(pin);
        if (pwm) {
          timersNeeded.add(pwm.timerId);
          if (!pinsByTimer.has(pwm.timerId)) {
            pinsByTimer.set(pwm.timerId, []);
          }
          pinsByTimer.get(pwm.timerId)!.push(pin);
        }
      }
      
      for (const timerId of timersNeeded) {
        lines.push(`_init_pwm_${timerId}();  // Initialize PWM ${timerId}`);
      }
      
      for (const [timerId, pins] of pinsByTimer) {
        for (const pin of pins) {
          const pwm = getPWMInfo(pin);
          if (pwm) {
            lines.push(`${pwm.tccr} |= (1 << ${pwm.comBit});  // Enable PWM output on D${pin}`);
          }
        }
      }
    }
    
    return lines;
  }

  override symbolAliases(program?: ProgramIR, ctx?: PlatformContext): Record<string, string> {
    return this.resolveAvrProfileCached(program, ctx).symbolAliases;
  }

  /**
   * Resolve HAL operations to native AVR register access.
   *
   * This override is what makes the strategy "native AVR": every GPIO, PWM,
   * and ADC op is lowered to direct register manipulation (PORTB/DDRB/PINB,
   * OCRnx, ADMUX/ADC) instead of Arduino Wiring calls (digitalWrite etc.).
   * Ops not handled here (timing/i2c/spi/uart/interrupt) fall through to the
   * parent ArduinoStrategy so we don't have to re-implement those.
   */
  override resolveHALOperation(op: HALOpIR): { code?: string; expression?: string } | undefined {
    switch (op.operation) {
      case "gpio.set_mode":
        return { code: `${nativePinMode(op.pin, op.mode)};` };
      case "gpio.write":
        return { code: `${nativeDigitalWrite(op.pin, this.gpioValueLiteral(op.value))};` };
      case "gpio.read":
        return { expression: nativeDigitalRead(op.pin) };
      case "gpio.toggle": {
        const info = getPinInfo(op.pin);
        if (!info) return { code: `/* invalid pin ${op.pin} */;` };
        // AVR idiom: writing a 1 to PINx toggles the corresponding bit.
        return { code: `${info.pinReg} |= ${getPinBitMask(op.pin)};` };
      }
      case "pwm.write":
        return { code: `${nativeAnalogWrite(op.pin, this.renderPwmDuty(op.duty))};` };
      case "adc.read":
        return { expression: nativeAnalogRead(op.pin) };
      default:
        // Timing, I2C, SPI, UART, interrupt, tone, etc. stay on the
        // Arduino Wiring API — they are not what "native AVR" optimizes.
        return super.resolveHALOperation(op);
    }
  }

  /**
   * Normalize a gpio.write value (literal 0/1 or a runtime expression string)
   * into the token form nativeDigitalWrite expects.
   */
  private gpioValueLiteral(value: 0 | 1 | string): string {
    if (value === 1) return "HIGH";
    if (value === 0) return "LOW";
    return value;
  }

  /**
   * Render a pwm.write duty value (numeric or expression string).
   */
  private renderPwmDuty(duty: number | string): string {
    return typeof duty === "number" ? String(duty) : duty;
  }

  override transformConsoleCall(
    method: string,
    renderedArgs: string,
    forHeader: boolean,
  ): string {
    const semi = forHeader ? "" : ";";
    switch (method) {
      case 'log':
        return `_uart_println(${renderedArgs})${semi}`;
      case 'error':
        return `_uart_print("[ERROR] "); _uart_println(${renderedArgs})${semi}`;
      case 'warn':
        return `_uart_print("[WARN] "); _uart_println(${renderedArgs})${semi}`;
      default:
        return `_uart_println(${renderedArgs})${semi}`;
    }
  }

  override transformConsoleExpression(_method: string, _renderedArgs: string): string | undefined {
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// Export as PlatformStrategy for architecture package convention
// ---------------------------------------------------------------------------

export { NativeAVRStrategy as PlatformStrategy };