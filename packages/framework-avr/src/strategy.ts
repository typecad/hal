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
import { activeChip, setActiveChip } from './chips/index.js';
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

  // On ATmega2560, channels ≥8 require the MUX5 bit in ADCSRB. The 328P
  // has no MUX5, so we only emit the ADCSRB write when the chip has
  // high channels (detected by checking if any channel ≥8 exists).
  // ADMUX MUX bits get channel & 0x07; MUX5 extends the channel space.
  // (channel & 0x1F alone wrongly selects differential encodings for 8–15.)
  const hasMux5 = Object.values(activeChip.adc.channelsByPin).some(c => c >= 8);
  const mux5Write = hasMux5
    ? (channel >= 8 ? `ADCSRB |= (1 << MUX5); ` : `ADCSRB &= ~(1 << MUX5); `)
    : '';
  const admuxChannel = channel & 0x07;

  // Preserve REFS bits so adc.set_reference survives across reads. Default
  // AVcc is installed once by _init_adc().
  return `({ ` +
    `${mux5Write}` +
    `ADMUX = (ADMUX & ((1 << REFS1) | (1 << REFS0))) | ${admuxChannel}; ` +
    `ADCSRA |= (1 << ADSC); ` +
    `while (ADCSRA & (1 << ADSC)); ` +
    `ADC; ` +
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
  // Override the ID to replace the default arduino strategy when this
  // framework is loaded. Both frameworks use id "arduino" — the last-loaded
  // framework wins in the strategy registry, which is correct: the user's
  // --framework flag determines which package is loaded.
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
   * Strip Arduino library includes that the native drivers replace. The HAL
   * proxy metadata (__includes) registers <Wire.h>, <SPI.h>, <EEPROM.h>,
   * <Arduino.h> — all of which link the Arduino core. Since framework-avr
   * provides native register-level drivers for every peripheral, these are
   * dead weight that pulls in the core unnecessarily.
   */
  filterRequiredIncludes(includes: string[]): string[] {
    return includes.filter(inc =>
      !inc.includes('<Wire.h>') &&
      !inc.includes('<SPI.h>') &&
      !inc.includes('<EEPROM.h>') &&
      !inc.includes('<Arduino.h>')
    );
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
   * This strategy provides a native console implementation via UART, plus the
   * inherited Arduino polyfills (cuttlefish_halt, string_methods, timer_methods,
   * async_runtime). The console polyfill is AVR-native; the rest are inherited
   * verbatim so setInterval/setTimeout and async/await work on AVR.
   */
  override nativePolyfills(): Set<string> {
    return new Set(['console', 'native_millis', ...super.nativePolyfills()]);
  }

  /**
   * Generate native polyfills: the AVR console (UART) polyfill, merged with
   * the parent's polyfills (timer_methods, async_runtime, string_methods,
   * cuttlefish_halt). Previously this returned only console, which silently
   * dropped setInterval/setTimeout support — the __tc_TimerRuntime that backs
   * them was never emitted.
   */
  override generateNativePolyfills(program?: ProgramIR, ctx?: PlatformContext): RuntimePolyfillIR[] {
    const parentPolyfills = program
      ? super.generateNativePolyfills(program, ctx)
      : [];

    // The native millis()/micros() Timer0 ISR polyfill is always emitted —
    // timing is foundational (setInterval, delay-relative ops, the async
    // runtime, and Timing.millis() all depend on it). It lives in polyfills
    // (not shimLines) because the emit pipeline filters shim lines containing
    // 'millis()' when the program doesn't directly call it (setup.ts:225),
    // which would silently drop the definition.
    //
    // Math matches Arduino wiring.c (fast PWM, 256 ticks/overflow):
    //   us_per_ovf = prescaler * 256 / (F_CPU/1e6)
    //   MILLIS_INC / FRACT_* accumulate whole milliseconds in the ISR so the
    //   soft counter never multiplies into a 32-bit overflow on long uptimes.
    // Constants are baked from the chip descriptor (polyfills emit before the
    // F_CPU #define in shimLines).
    const prescaler = activeChip.millisTimer.prescaler;
    const ovfVector = activeChip.millisTimer.overflowVector;
    const cyclesPerUs = activeChip.fcpu / 1_000_000;
    const usPerOvf = (prescaler * 256) / cyclesPerUs;
    const millisInc = Math.floor(usPerOvf / 1000);
    const fractInc = (usPerOvf % 1000) >> 3;
    const fractMax = 1000 >> 3;
    const microsMul = prescaler / cyclesPerUs;
    const csBits = prescaler === 64
      ? '(1 << CS01) | (1 << CS00)'
      : '(1 << CS00)';
    const millisPolyfill: RuntimePolyfillIR = {
      id: 'native_millis',
      kind: 'polyfill',
      domain: 'arduino',
      requiredIncludes: [],
      forwardDeclarations: [],
      helperStructs: [],
      helperFunctions: [
        `// Native millis()/micros() — Timer0 overflow ISR (no Arduino core).`,
        `// Fast PWM + presc ${prescaler}: ${usPerOvf} us/overflow @ ${activeChip.fcpu} Hz.`,
        `static volatile unsigned long _tc_millis_count = 0;`,
        `static volatile unsigned long _tc_overflow_count = 0;`,
        `static volatile unsigned char _tc_millis_fract = 0;`,
        `ISR(${ovfVector}) {`,
        `  unsigned long m = _tc_millis_count;`,
        `  unsigned char f = _tc_millis_fract;`,
        `  m += ${millisInc};`,
        `  f += ${fractInc};`,
        `  if (f >= ${fractMax}) { f -= ${fractMax}; m += 1; }`,
        `  _tc_millis_fract = f;`,
        `  _tc_millis_count = m;`,
        `  _tc_overflow_count++;`,
        `}`,
        `static inline void _init_millis() {`,
        `  // Fast PWM (WGM02:0 = 3), preserving COM bits for PWM pins.`,
        `  // Same mode as Timer0 PWM init so TOV0 stays at 256 ticks/overflow.`,
        `  TCCR0A = (TCCR0A & ~((1 << WGM01) | (1 << WGM00))) | (1 << WGM01) | (1 << WGM00);`,
        `  TCCR0B = (TCCR0B & ~((1 << WGM02) | (1 << CS02) | (1 << CS01) | (1 << CS00))) | ${csBits};`,
        `  TIMSK0 = (1 << TOIE0);`,
        `  sei();  // global IRQ — must live here: shim lines containing "millis()" get filtered`,
        `}`,
        `static inline unsigned long millis() {`,
        `  unsigned long m; uint8_t oldSREG = SREG; cli();`,
        `  m = _tc_millis_count;`,
        `  SREG = oldSREG; return m;`,
        `}`,
        `static inline unsigned long micros() {`,
        `  unsigned long m; uint8_t t; uint8_t oldSREG = SREG; cli();`,
        `  m = _tc_overflow_count; t = TCNT0;`,
        `  if ((TIFR0 & _BV(TOV0)) && t < 255) m++;`,
        `  SREG = oldSREG;`,
        `  return ((m << 8) + t) * ${microsMul}UL;`,
        `}`,
      ],
      shimMacros: [],
      dependencies: [],
    };

    const usesConsole = this.detectConsoleUsage(program);
    if (!usesConsole) {
      return [millisPolyfill, ...parentPolyfills];
    }

    const consolePolyfill: RuntimePolyfillIR = {
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
    };

    return [millisPolyfill, consolePolyfill, ...parentPolyfills];
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
        '// Shared peek latch — consumed by _uart_read/_uart_available.',
        'static unsigned char _uart_peek_byte = 0;',
        'static uint8_t _uart_has_peek = 0;',
        'static uint8_t _uart_written = 0;',
        '',
        'static inline void _uart_init(unsigned long baud) {',
        '  // Prefer U2X (double speed) for better baud accuracy (e.g. 115200 @ 16 MHz).',
        '  uint16_t ubrr;',
        '  UCSR0A = (1 << U2X0);',
        '  ubrr = (uint16_t)((F_CPU / 4 / baud - 1) / 2);',
        '  if (ubrr > 4095) {',
        '    UCSR0A = 0;',
        '    ubrr = (uint16_t)((F_CPU / 8 / baud - 1) / 2);',
        '  }',
        '  UBRR0H = (unsigned char)(ubrr >> 8);',
        '  UBRR0L = (unsigned char)ubrr;',
        '  UCSR0B = (1 << RXEN0) | (1 << TXEN0);',
        '  UCSR0C = (1 << UCSZ01) | (1 << UCSZ00);  // 8N1',
        '  _uart_has_peek = 0;',
        '  _uart_written = 0;',
        '}',
        '',
        'static inline int _uart_available() {',
        '  return (_uart_has_peek || (UCSR0A & (1 << RXC0))) ? 1 : 0;',
        '}',
        '',
        'static inline int _uart_read() {',
        '  if (_uart_has_peek) { _uart_has_peek = 0; return _uart_peek_byte; }',
        '  while (!(UCSR0A & (1 << RXC0)));',
        '  return UDR0;',
        '}',
        '',
        'static inline void _uart_write(unsigned char data) {',
        '  // Do not cli() while waiting — Timer0 overflows (~1 ms) must keep firing',
        '  // or millis() stalls during sustained TX.',
        '  while (!(UCSR0A & (1 << UDRE0)));',
        '  UDR0 = data;',
        '  _uart_written = 1;',
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
        `  ADMUX = ${activeChip.adc.referenceBits};  // default reference (preserved across reads)`,
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
    
    // Native delay functions. _delay_us requires a compile-time constant, so
    // runtime values use _delay_loop_2 (4 cycles/iteration) instead of a
    // per-us loop that adds ~20–25% overhead.
    lines.push(
      'static inline void _native_delay_ms(unsigned long ms) { while (ms--) _delay_ms(1); }',
      'static inline void _native_delay_us(unsigned int us) {',
      '  while (us > 0) {',
      '    unsigned int chunk = us > 1000 ? 1000 : us;',
      '    uint16_t loops = (uint16_t)(((F_CPU / 1000000UL) * chunk) / 4UL);',
      '    if (loops) _delay_loop_2(loops);',
      '    us -= chunk;',
      '  }',
      '}',
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

    // ── Native SPI driver — SPCR/SPSR/SPDR registers (no Arduino SPI lib) ──
    {
      const spi = activeChip.spi;
      lines.push(
        `// Native SPI driver — ${activeChip.id} SPI master mode.`,
        'static inline void _spi_init() {',
        `  ${spi.ddr} |= (1 << ${spi.mosiBit}) | (1 << ${spi.sckBit}) | (1 << ${spi.ssBit});  // MOSI, SCK, /SS as outputs`,
        `  ${spi.ddr} &= ~(1 << ${spi.misoBit});  // MISO as input`,
        '  SPCR = (1 << SPE) | (1 << MSTR);',
        '}',
        '',
        'static inline uint8_t _spi_transfer(uint8_t data) {',
        '  SPDR = data;',
        '  while (!(SPSR & (1 << SPIF)));',
        '  return SPDR;',
        '}',
        '',
        'static inline void _spi_set_mode(uint8_t mode) {',
        '  SPCR = (SPCR & ~((1 << CPOL) | (1 << CPHA)))',
        '       | ((mode & 2) ? (1 << CPOL) : 0)',
        '       | ((mode & 1) ? (1 << CPHA) : 0);',
        '}',
        '',
        'static inline void _spi_set_bit_order(uint8_t lsbFirst) {',
        '  if (lsbFirst) SPCR |= (1 << DORD); else SPCR &= ~(1 << DORD);',
        '}',
        '',
        'static inline void _spi_begin_transaction(unsigned long settings) {',
        '  (void)settings;',
        '}',
        ''
      );
    }

    // ── Native UART extensions — print expressions, peek, flush ──────────
    // The base _uart_* helpers (init/write/read/available/print/println) are
    // already emitted above. These add expression-printing (for uart.print
    // with numeric values), peek, and flush.
    lines.push(
      '// Print a numeric/string expression via UART (template handles all types).',
      'template<typename T> inline void _uart_print_expr(T val) {',
      '  _uart_print_long((long)val);',
      '}',
      'inline void _uart_print_expr(const char* s) { _uart_print(s); }',
      'inline void _uart_print_expr(char c) { _uart_write(c); }',
      'inline void _uart_print_expr(float f) { _uart_print_float(f); }',
      'inline void _uart_print_expr(double f) { _uart_print_float(f); }',
      'inline void _uart_print_expr(bool b) { _uart_print(b ? "true" : "false"); }',
      '',
      'template<typename T> inline void _uart_println_expr(T val) {',
      '  _uart_print_long((long)val); _uart_write(\'\\r\'); _uart_write(\'\\n\');',
      '}',
      'inline void _uart_println_expr(const char* s) { _uart_println(s); }',
      'inline void _uart_println_expr(float f) { _uart_print_float(f); _uart_write(\'\\r\'); _uart_write(\'\\n\'); }',
      '',
      'static inline int _uart_peek() {',
      '  if (_uart_has_peek) return _uart_peek_byte;',
      '  if (UCSR0A & (1 << RXC0)) { _uart_peek_byte = UDR0; _uart_has_peek = 1; return _uart_peek_byte; }',
      '  return -1;',
      '}',
      '',
      'static inline void _uart_flush() {',
      '  // TXC stays 0 until the first byte is sent; skip if nothing was written.',
      '  if (!_uart_written) return;',
      '  while (!(UCSR0A & (1 << TXC0)));',
      '}',
      ''
    );

    // ── Native TWI (I2C) driver — TWBR/TWCR/TWDR/TWSR (no Arduino Wire) ───
    // Master-mode state machine: START → SLA+W → write data → STOP, and
    // repeated-START → SLA+R → read N bytes → STOP. An RX ring buffer backs
    // requestFrom/read/available. TWSR status codes are checked after each
    // operation; errors are silent (the read/write returns 0/false).
    {
      const twi = activeChip.twi;
      lines.push(
        '// Native TWI (I2C) master driver.',
        '#define TWI_BUFFER_LENGTH 32',
        'static volatile uint8_t _twi_rx_buffer[TWI_BUFFER_LENGTH];',
        'static volatile uint8_t _twi_rx_head = 0;',
        'static volatile uint8_t _twi_rx_tail = 0;',
        'static volatile uint8_t _twi_master_error = 0;',
        '',
        '// TWBR = ((F_CPU / SCL) - 16) / 2  (prescaler = 1, TWSR TWPS = 0)',
        'static inline void _twi_init() {',
        '  TWSR = 0;  // prescaler 1',
        '  TWBR = ((F_CPU / 100000UL) - 16) / 2;  // default 100 kHz',
        '  TWCR = (1 << TWEN);  // enable TWI',
        '}',
        '',
        'static inline void _twi_set_clock(unsigned long hz) {',
        '  TWBR = ((F_CPU / hz) - 16) / 2;',
        '}',
        '',
        '// Send START or repeated START condition.',
        'static inline void _twi_start() {',
        '  TWCR = (1 << TWINT) | (1 << TWSTA) | (1 << TWEN);',
        '  while (!(TWCR & (1 << TWINT)));',
        '}',
        '',
        '// Send STOP and wait until hardware clears TWSTO (STOP complete).',
        'static inline void _twi_stop() {',
        '  TWCR = (1 << TWINT) | (1 << TWSTO) | (1 << TWEN);',
        '  while (TWCR & (1 << TWSTO));',
        '}',
        '',
        '// Write one byte and wait for ACK/NACK. Returns TWSR status (0xF8 mask);',
        '// ACK statuses are 0x18 (SLA+W) / 0x28 (data), not 0.',
        'static inline uint8_t _twi_write_byte(uint8_t data) {',
        '  TWDR = data;',
        '  TWCR = (1 << TWINT) | (1 << TWEN);',
        '  while (!(TWCR & (1 << TWINT)));',
        '  return (TWSR & 0xF8);  // status code',
        '}',
        '',
        '// Write a C array buffer of known size.',
        'static inline void _twi_write_buffer(const uint8_t* data, size_t len) {',
        '  for (size_t i = 0; i < len; i++) _twi_write_byte(data[i]);',
        '}',
        '',
        '// Read one byte: ack=1 sends ACK (expect more), ack=0 sends NACK (last).',
        'static inline uint8_t _twi_read_byte(uint8_t ack) {',
        '  TWCR = (1 << TWINT) | (1 << TWEN) | (ack ? (1 << TWEA) : 0);',
        '  while (!(TWCR & (1 << TWINT)));',
        '  return TWDR;',
        '}',
        '',
        '// Ring-buffer helpers for received data.',
        'static inline int _twi_available() {',
        '  return (int)(_twi_rx_head - _twi_rx_tail);',
        '}',
        'static inline int _twi_read() {',
        '  if (_twi_rx_head == _twi_rx_tail) return -1;',
        '  uint8_t b = _twi_rx_buffer[_twi_rx_tail++];',
        '  return b;',
        '}',
        '',
        '// Begin a master transmission to the given address (SLA+W).',
        'static inline void _twi_begin_transmission(uint8_t address) {',
        '  _twi_start();',
        '  _twi_write_byte(address << 1);  // SLA+W',
        '}',
        '',
        '// End a master transmission: send STOP if requested.',
        'static inline void _twi_end_transmission(uint8_t sendStop) {',
        '  if (sendStop) _twi_stop();',
        '}',
        '',
        '// Master read: request N bytes from a slave into the RX ring buffer.',
        'static inline void _twi_request_from(uint8_t address, uint8_t count, uint8_t sendStop) {',
        '  _twi_start();',
        '  _twi_write_byte((address << 1) | 1);  // SLA+R',
        '  _twi_rx_head = 0; _twi_rx_tail = 0;',
        '  for (uint8_t i = 0; i < count; i++) {',
        '    uint8_t ack = (i < count - 1) ? 1 : 0;  // ACK all but last',
        '    if (_twi_rx_head < TWI_BUFFER_LENGTH) {',
        '      _twi_rx_buffer[_twi_rx_head++] = _twi_read_byte(ack);',
        '    } else {',
        '      _twi_read_byte(0);',
        '    }',
        '  }',
        '  if (sendStop) _twi_stop();',
        '}',
        '',
        '// Bus recovery: clock up to 9 SCL pulses to release a stuck slave.',
        'static inline void _twi_recover() {',
        `  ${twi.ddr} |= (1 << ${twi.sclBit});  // SCL as output`,
        `  ${twi.ddr} &= ~(1 << ${twi.sdaBit});  // SDA as input`,
        '  for (int i = 0; i < 9; i++) {',
        `    ${twi.port} &= ~(1 << ${twi.sclBit}); _native_delay_us(5);`,
        `    ${twi.port} |= (1 << ${twi.sclBit}); _native_delay_us(5);`,
        '  }',
        '  _twi_stop();  // send STOP to release the bus',
        `  ${twi.ddr} &= ~(1 << ${twi.sclBit});  // SCL back to TWI control`,
        '}',
        ''
      );
    }

    // ── Native EEPROM driver — avr-libc <avr/eeprom.h> (no Arduino lib) ──
    // Provides the same EEPROM.read()/write()/update() interface the parent's
    // AVR Preferences shim and the HAL eeprom.ts proxy emit, but backed by
    // avr-libc eeprom_read_byte/eeprom_write_byte/eeprom_update_byte.
    lines.push(
      '#include <avr/eeprom.h>',
      '// Native EEPROM — wraps avr-libc, matching the Arduino EEPROM API.',
      'struct _NativeEEPROM {',
      '  uint8_t read(int addr) { return eeprom_read_byte((uint8_t*)addr); }',
      '  void write(int addr, uint8_t val) { eeprom_write_byte((uint8_t*)addr, val); }',
      '  void update(int addr, uint8_t val) { eeprom_update_byte((uint8_t*)addr, val); }',
      '  uint16_t length() { return E2END + 1; }',
      '} EEPROM;',
      ''
    );

    // Native tone() driver — Timer2 CTC interrupts soft-toggling the requested
    // pin. Duration is enforced by counting toggles in the ISR (Arduino-style).
    // Conflicts with Timer2 PWM (D3/D11 on 328P, D9/D10 on Mega).
    lines.push(
      '// Native tone driver — Timer2 CTC + GPIO toggle.',
      'static volatile long _tc_tone_toggle_count = 0;',
      'static volatile uint8_t *_tc_tone_port = 0;',
      'static volatile uint8_t _tc_tone_mask = 0;',
      '',
      'static void _tc_tone_stop_inline(void) {',
      '  TIMSK2 &= ~(1 << OCIE2A);',
      '  TCCR2B = 0;',
      '  TCCR2A = 0;',
      '  _tc_tone_toggle_count = 0;',
      '  if (_tc_tone_port) *_tc_tone_port &= ~_tc_tone_mask;  // idle low',
      '}',
      '',
      'ISR(TIMER2_COMPA_vect) {',
      '  if (_tc_tone_port) *_tc_tone_port ^= _tc_tone_mask;',
      '  if (_tc_tone_toggle_count > 0) {',
      '    _tc_tone_toggle_count--;',
      '    if (_tc_tone_toggle_count == 0) _tc_tone_stop_inline();',
      '  }',
      '}',
      '',
      'static void _tc_tone_play(volatile uint8_t *port, volatile uint8_t *ddr, uint8_t mask, unsigned long freq, unsigned long duration) {',
      '  if (freq == 0) { _tc_tone_stop_inline(); return; }',
      '  _tc_tone_port = port;',
      '  _tc_tone_mask = mask;',
      '  *ddr |= mask;  // pin as output',
      '  // CTC mode; ISR toggles the pin at 2*freq for a square wave of `freq` Hz.',
      '  TCCR2A = (1 << WGM21);',
      '  const unsigned long prescalers[] = {1, 8, 32, 64, 128, 256, 1024};',
      '  const uint8_t cs_bits[] = {(1<<CS20), (1<<CS21), (1<<CS21)|(1<<CS20), (1<<CS22), (1<<CS22)|(1<<CS20), (1<<CS22)|(1<<CS21), (1<<CS22)|(1<<CS21)|(1<<CS20)};',
      '  unsigned long ocr = 255;',
      '  uint8_t cs = cs_bits[0];',
      '  for (int i = 0; i < 7; i++) {',
      '    unsigned long v = (F_CPU / (2UL * prescalers[i] * freq)) - 1;',
      '    if (v < 256) { ocr = v; cs = cs_bits[i]; break; }',
      '  }',
      '  OCR2A = (uint8_t)ocr;',
      '  if (duration > 0) {',
      '    // toggles needed = 2 * freq * duration_ms / 1000',
      '    _tc_tone_toggle_count = (long)((2UL * freq * duration) / 1000UL);',
      '    if (_tc_tone_toggle_count <= 0) _tc_tone_toggle_count = 1;',
      '  } else {',
      '    _tc_tone_toggle_count = -1;  // continuous',
      '  }',
      '  TCNT2 = 0;',
      '  TCCR2B = cs;',
      '  TIMSK2 |= (1 << OCIE2A);',
      '}',
      '',
      'static void _tc_tone_stop(void) {',
      '  _tc_tone_stop_inline();',
      '}',
      ''
    );

    // External interrupt handlers — data-driven from the chip descriptor.
    // Native ISR dispatch via function-pointer trampolines. The bare-metal
    // main() prevents the Arduino core from being linked, so these ISRs own
    // the interrupt vectors exclusively.
    if (usesExternalInterrupts) {
      const intPins = Object.entries(activeChip.interruptsByPin);
      if (intPins.length > 0) {
        for (const [, info] of intPins) {
          lines.push(
            // Qualify the pointer as volatile, not the pointed-to void return.
            `static void (* volatile ${info.handler})(void) = 0;`,
          );
        }
        lines.push('');
        for (const [, info] of intPins) {
          lines.push(
            `ISR(${info.vector}) { if (${info.handler}) ${info.handler}(); }`,
            '',
          );
        }
      }
    }

    // Merge in the parent Arduino shims. The AVR block above is emitted first
    // (it defines F_CPU and the AVR peripheral helpers); the parent then
    // contributes the conditional helpers its emit path also depends on —
    // CUTTLEFISH_UNDEFINED / cuttlefish_nullish (for `undefined`/`??`),
    // PinGroup, async runtime, string buffer, etc. Without this delegation,
    // any program using `undefined` or `??` fails to compile because the
    // transpiler emits references to symbols this override never defines.
    if (program && ctx) {
      let parentLines = super.shimLines(program, ctx);
      // The parent's __tc_Timing struct calls ::delay()/::millis()/::micros()
      // with global scope, bypassing the AVR native helpers. Filter it out
      // and emit a native replacement that routes through _native_delay_ms,
      // _native_delay_us, and the native millis()/micros() polyfill.
      parentLines = this.filterShimBlock(parentLines, 'struct __tc_Timing {', '} Timing;');

      // Strip Arduino core includes — the bare-metal main() prevents the
      // Arduino core from being linked, so these headers are dead weight.
      // The native drivers provide every peripheral.
      parentLines = parentLines.filter(l =>
        !l.includes('<Arduino.h>') &&
        !l.includes('<Wire.h>') &&
        !l.includes('<SPI.h>') &&
        !l.includes('<EEPROM.h>')
      );

      lines.push(...parentLines);

      // Native __tc_Timing replacement — delegates to AVR helpers, not the
      // Arduino core. freeHeap() uses the avr-libc __heap_start/__brkval trick.
      // Qualifying ::millis()/::micros() is required: an unqualified call inside
      // a member of the same name is infinite recursion (stack overflow → hang).
      lines.push(
        '// Native __tc_Timing — delegates to AVR helpers, not Arduino core.',
        'struct __tc_Timing {',
        '    unsigned long millis() { return ::millis(); }',
        '    unsigned long micros() { return ::micros(); }',
        '    void delay(unsigned long ms) { _native_delay_ms(ms); }',
        '    void delayMicroseconds(unsigned int us) { _native_delay_us(us); }',
        '    unsigned long freeHeap() {',
        '        extern int __heap_start, *__brkval;',
        '        int v;',
        '        return (unsigned long)((size_t)&v - (__brkval == 0 ? (size_t)&__heap_start : (size_t)__brkval));',
        '    }',
        '} Timing;',
        ''
      );
    }

    // Bare-metal main() — overrides the Arduino core's main(), preventing
    // the core from being linked. Protocol I/O uses native _uart_* helpers,
    // so Serial is never referenced. Do NOT put the substring "millis()" in
    // any of these shim lines: the emit pipeline filters them out when
    // source analysis misses Timing usage (setup.ts), which previously
    // dropped both _init_millis() and sei() and left the soft clock stuck
    // at 0. Timer backbone starts from setupInitCode → _init_millis (polyfill).
    lines.push(
      '// Bare-metal entry point — prevents the Arduino core from being linked.',
      'int main(void) {',
      '  _native_delay_ms(2000);  // let host open port after DTR reset',
      '  setup();',
      '  while (1) {',
      '    loop();',
      '  }',
      '  return 0;',
      '}',
      ''
    );

    return lines;
  }

  /**
   * Remove a contiguous block of shim lines between startMarker and endMarker
   * (inclusive). Mirrors the filterShimBlock utility in the emit pipeline.
   */
  private filterShimBlock(lines: string[], startMarker: string, endMarker: string): string[] {
    const startIdx = lines.findIndex(l => l.includes(startMarker));
    if (startIdx === -1) return lines;
    const endIdx = lines.findIndex((l, i) => i >= startIdx && l.includes(endMarker));
    if (endIdx === -1) return lines;
    const filtered = lines.slice();
    filtered.splice(startIdx, endIdx - startIdx + 1);
    while (filtered.length > 0 && filtered[startIdx] === '') {
      filtered.splice(startIdx, 1);
    }
    return filtered;
  }
  
  /**
   * Generate setup initialization code based on peripheral usage.
   */
  override setupInitCode(program?: ProgramIR, ctx?: PlatformContext): string[] {
    const lines: string[] = [];

    // Only init UART if the program itself uses console output. Honor
    // ctx.console.baudRate when set (parity with framework-arduino); fall back
    // to the chip default. The expect harness provides its own _uart_init via
    // OutputShim, so skipping when there's no console avoids a double-init.
    if (program && this.detectConsoleUsage(program)) {
      const baud = ctx?.console?.baudRate ?? activeChip.uart.defaultBaud;
      lines.push(`_uart_init(${baud})`);
    }

    // Start the Timer0 soft-clock before anything else — setInterval,
    // delay-relative ops, and the async runtime all depend on it.
    // _init_millis (polyfill) also calls sei().
    lines.push('_init_millis()');

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

    // Global interrupts are enabled inside _init_millis() (polyfill), which
    // runs first in setup via setupInitCode.

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
      // ── Native timing — route through AVR shims, not Arduino core ──────
      case "timing.delay":
        return { code: `_native_delay_ms(${(op as any).ms});` };
      case "timing.delay_microseconds":
        return { code: `_native_delay_us(${(op as any).us});` };
      case "timing.millis":
        return { expression: "millis()" };
      case "timing.micros":
        return { expression: "micros()" };
      // ── Native external interrupts — wire the ISR trampoline + EICRA ──
      case "interrupt.attach": {
        const iinfo = getInterruptInfo(op.pin);
        if (!iinfo) return { code: `/* pin ${op.pin} has no external interrupt */;` };
        const modeBits = this.interruptModeBits(iinfo.interrupt, (op as any).mode);
        return { code: `${iinfo.handler} = ${(op as any).handler}; ${modeBits}; EIMSK |= (1 << ${iinfo.interrupt});` };
      }
      case "interrupt.detach": {
        const iinfo = getInterruptInfo(op.pin);
        if (!iinfo) return { code: `/* pin ${op.pin} has no external interrupt */;` };
        return { code: `EIMSK &= ~(1 << ${iinfo.interrupt}); ${iinfo.handler} = 0;` };
      }
      // ── ADC reference/voltage — native ADMUX/ADC, not analogReference() ──
      case "adc.set_reference": {
        const refBits = this.adcReferenceBits((op as any).reference);
        return { code: `ADMUX = (ADMUX & ~((1 << REFS1) | (1 << REFS0))) | ${refBits};` };
      }
      case "adc.read_voltage": {
        const vop = op as any;
        const vRef = vop.vRef ?? 5.0;
        const maxVal = vop.maxValue ?? 1023.0;
        return { expression: `((double)(${nativeAnalogRead(op.pin)}) * ${vRef} / ${maxVal})` };
      }
      case "adc.get_resolution":
        return { expression: "10" };
      // ── Pulse measurement — native micros() + GPIO, not Arduino pulseIn() ──
      case "pulse.in":
      case "pulse.in_long": {
        // pulse.in_long is the same as pulse.in on AVR (no longer-resolution timer).
        const pop = op as any;
        const target = pop.value === 1 ? 1 : 0;
        const readExpr = nativeDigitalRead(op.pin);
        const hasTimeout = pop.timeout !== undefined;
        const timeoutWait = hasTimeout
          ? `if (micros() - __start >= ${pop.timeout}) { __timed_out = 1; break; }`
          : '';
        return {
          expression:
            `({ unsigned long __start = micros(); unsigned long __result = 0; uint8_t __timed_out = 0; ` +
            `while ((${readExpr}) != ${target}) { ${timeoutWait} } ` +
            `if (!__timed_out) { __start = micros(); while ((${readExpr}) == ${target}) { ${timeoutWait} } ` +
            `if (!__timed_out) __result = micros() - __start; } ` +
            `__result; })`,
        };
      }
      // ── Shift out/in — native GPIO bit-bang, not Arduino shiftOut()/shiftIn() ──
      case "shift.out": {
        const sop = op as any;
        const dataInfo = getPinInfo(sop.dataPin);
        const clockInfo = getPinInfo(sop.clockPin);
        if (!dataInfo || !clockInfo) return { code: `/* shift.out: invalid pin */;` };
        const dataMask = getPinBitMask(sop.dataPin);
        const clockMask = getPinBitMask(sop.clockPin);
        const dataPort = dataInfo.port;
        const clockPort = clockInfo.port;
        const lsb = sop.bitOrder === "lsb" || sop.bitOrder === "LSBFIRST";
        // Emit an IIFE that clocks out 8 bits using native PORT/DDR registers.
        const bitTest = lsb ? `(1 << __i)` : `(1 << (7 - __i))`;
        return { code: `{ for (int __i = 0; __i < 8; __i++) { if ((${sop.value}) & ${bitTest}) ${dataPort} |= ${dataMask}; else ${dataPort} &= ~${dataMask}; ${clockPort} |= ${clockMask}; ${clockPort} &= ~${clockMask}; } }` };
      }
      case "shift.in": {
        const sop = op as any;
        const dataInfo = getPinInfo(sop.dataPin);
        const clockInfo = getPinInfo(sop.clockPin);
        if (!dataInfo || !clockInfo) return { expression: `0 /* shift.in: invalid pin */` };
        const dataPinReg = dataInfo.pinReg;
        const dataMask = getPinBitMask(sop.dataPin);
        const clockMask = getPinBitMask(sop.clockPin);
        const clockPort = clockInfo.port;
        const lsb = sop.bitOrder === "lsb" || sop.bitOrder === "LSBFIRST";
        const bitShift = lsb ? `__i` : `(7 - __i)`;
        return { expression: `({ unsigned char __result = 0; for (int __i = 0; __i < 8; __i++) { ${clockPort} |= ${clockMask}; ${clockPort} &= ~${clockMask}; if ((${dataPinReg} & ${dataMask})) __result |= (1 << ${bitShift}); } __result; })` };
      }
      // ── Tone — native Timer2 CTC + GPIO toggle, not Arduino tone()/noTone() ──
      case "tone.play": {
        const top = op as any;
        const info = getPinInfo(op.pin);
        if (!info) return { code: `/* tone: invalid pin ${op.pin} */;` };
        const mask = getPinBitMask(op.pin);
        const freq = top.frequency;
        const dur = top.duration !== undefined ? top.duration : 0;
        return { code: `_tc_tone_play(&${info.port}, &${info.ddr}, ${mask}, ${freq}, ${dur});` };
      }
      case "tone.stop":
        return { code: `_tc_tone_stop();` };
      // ── SPI — native SPCR/SPSR/SPDR registers, not Arduino SPI library ──
      case "spi.begin":
        return { code: `_spi_init();` };
      case "spi.end":
        return { code: `SPCR = 0;` };
      case "spi.transfer":
        return { expression: `_spi_transfer(${(op as any).data})` };
      case "spi.begin_transaction":
        // SPISettings configure: fold into SPCR/SPSR. The settings expression
        // is resolved by the HAL; we apply the mode/frequency at begin time.
        return { code: `_spi_begin_transaction(${(op as any).settings});` };
      case "spi.end_transaction":
        return { code: `/* SPI end transaction */;` };
      case "spi.set_mode":
        return { code: `_spi_set_mode(${(op as any).mode});` };
      case "spi.set_bit_order":
        return { code: `_spi_set_bit_order(${(op as any).order === "lsb" ? 1 : 0});` };
      case "spi.cs_low":
        return { code: nativeDigitalWrite(op.pin, "LOW") + ";" };
      case "spi.cs_high":
        return { code: nativeDigitalWrite(op.pin, "HIGH") + ";" };
      // ── UART — native USART0 helpers, not Arduino HardwareSerial ────────
      case "uart.begin":
        return { code: `_uart_init(${(op as any).baud});` };
      case "uart.end":
        return { code: `UCSR0B = 0;` };
      case "uart.print":
        return { code: `_uart_print_expr(${(op as any).value});` };
      case "uart.println":
        return { code: `_uart_println_expr(${(op as any).value});` };
      case "uart.printf": {
        const uop = op as any;
        return { code: `{ char __buf[128]; snprintf(__buf, sizeof(__buf), ${uop.format}${uop.args.length > 0 ? ", " + uop.args.join(", ") : ""}); _uart_print(__buf); }` };
      }
      case "uart.write":
        return { code: `_uart_write(${(op as any).data});` };
      case "uart.read":
        return { expression: `_uart_read()` };
      case "uart.peek":
        return { expression: `_uart_peek()` };
      case "uart.available":
        return { expression: `_uart_available()` };
      case "uart.flush":
        return { code: `_uart_flush();` };
      // ── I2C — native TWBR/TWCR/TWDR/TWSR, not Arduino Wire library ──────
      case "i2c.begin":
        return { code: `_twi_init();` };
      case "i2c.end":
        return { code: `TWCR = 0;` };
      case "i2c.set_clock":
        return { code: `_twi_set_clock(${(op as any).hz});` };
      case "i2c.begin_transmission":
        return { code: `_twi_begin_transmission(${(op as any).address});` };
      case "i2c.write":
        return { code: `_twi_write_byte(${(op as any).data});` };
      case "i2c.write_bytes": {
        const wop = op as any;
        return { code: wop.bytes.map((b: number | string) => `_twi_write_byte(${b});`).join(" ") };
      }
      case "i2c.write_buffer":
        return { code: `_twi_write_buffer(${(op as any).data}, sizeof(${(op as any).data}));` };
      case "i2c.read_buffer": {
        // request_from already filled the RX ring; drain it (Arduino Wire.read()
        // semantics). Calling _twi_read_byte here would clock the bus after STOP
        // and hang forever waiting for TWINT.
        const rop = op as any;
        if (rop.buffer === "__DISCARD__") {
          return { code: `for (int __i = 0; __i < ${rop.count}; __i++) (void)_twi_read();` };
        }
        return { code: `for (int __i = 0; __i < ${rop.count}; __i++) ${rop.buffer}[__i] = _twi_read();` };
      }
      case "i2c.end_transmission":
        return { code: `_twi_end_transmission(${(op as any).stop ? 1 : 0});` };
      case "i2c.request_from": {
        const rfop = op as any;
        return { code: `_twi_request_from(${rfop.address}, ${rfop.quantity}, ${rfop.stop ? 1 : 0});` };
      }
      case "i2c.available":
        return { expression: `_twi_available()` };
      case "i2c.read":
        return { expression: `_twi_read()` };
      case "i2c.recover":
        return { code: `_twi_recover();` };
      // ── Invalid-on-AVR ops — no-op with a comment, not undefined symbols ──
      case "dac.write":
        return { code: `/* dac.write not supported on AVR (no DAC hardware) */;` };
      case "power.set_cpu_frequency":
        return { code: `/* set_cpu_frequency not supported on AVR */;` };
      default:
        // Ops not explicitly handled above fall through to the parent.
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
   * Emit EICRA/EICRB bit configuration for an external interrupt trigger mode.
   * Mode values come from the HAL IR: "rising" | "falling" | "change" | "low"
   * (or "high" which AVR treats as "low"-level like "low").
   *
   * INT0-3 use EICRA (ISCn0/ISCn1 bits at positions n*2). INT4-7 use EICRB
   * (ISCn0/ISCn1 at positions (n-4)*2). Only the ATmega2560 has INT4-7.
   */
  private interruptModeBits(interruptId: string, mode: string): string {
    const num = parseInt(interruptId.replace("INT", ""), 10);
    const reg = num < 4 ? "EICRA" : "EICRB";
    const bitBase = num < 4 ? num * 2 : (num - 4) * 2;
    const isc0 = `ISC${num}0`;
    const isc1 = `ISC${num}1`;
    // ISC bits: 00 = low level, 01 = any edge, 10 = falling, 11 = rising
    const set = (bits: string[]) =>
      bits.length === 0
        ? `${reg} &= ~((1 << ${isc0}) | (1 << ${isc1}))`
        : `${reg} = (${reg} & ~((1 << ${isc0}) | (1 << ${isc1}))) | (${bits.map(b => `(1 << ${b})`).join(" | ")})`;
    switch (mode?.toLowerCase()) {
      case "rising":   return set([isc0, isc1]);
      case "falling":  return set([isc1]);
      case "change":
      case "both":     return set([isc0]);
      case "low":
      case "high":
      case "level":    return set([]);
      default:         return set([isc0, isc1]); // default to rising
    }
  }

  /**
   * Map an ADC reference name to the AVR ADMUX REFS bits.
   * "default"/"vdd" → AVcc (REFS0), "internal" → 1.1V internal (REFS1|REFS0),
   * "external" → AREF (0), plus the Arduino macro spellings.
   */
  private adcReferenceBits(reference: string | number): string {
    const ref = typeof reference === "string" ? reference.toLowerCase().replace(/['"]/g, "") : "";
    switch (ref) {
      case "internal":
      case "internal1v1":
      case "1v1":
        return "(1 << REFS1) | (1 << REFS0)";
      case "external":
      case "aref":
        return "0";
      case "default":
      case "vdd":
      case "avcc":
      case "":
      default:
        return activeChip.adc.referenceBits;  // AVcc (REFS0) from descriptor
    }
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