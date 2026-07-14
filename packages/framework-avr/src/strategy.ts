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
    const prescaler = activeChip.millisTimer.prescaler;
    const ovfVector = activeChip.millisTimer.overflowVector;
    const millisPolyfill: RuntimePolyfillIR = {
      id: 'native_millis',
      kind: 'polyfill',
      domain: 'arduino',
      requiredIncludes: [],
      forwardDeclarations: [],
      helperStructs: [],
      helperFunctions: [
        `// Native millis()/micros() — Timer0 overflow ISR.`,
        `// Guarded with #ifndef ARDUINO so that when the Arduino core IS linked`,
        `// (builds via arduino-cli), the core's millis()/micros() and Timer0 ISR`,
        `// are used instead — avoiding a multiple-definition link error. In a`,
        `// bare-metal build (no Arduino core), these provide the timing backbone.`,
        `#ifndef ARDUINO`,
        `static volatile unsigned long _tc_millis_count = 0;`,
        `ISR(${ovfVector}) { _tc_millis_count++; }`,
        `static inline void _init_millis() {`,
        `  TCCR0A = 0;`,
        `  TCCR0B = ${prescaler === 64 ? '(1 << CS01) | (1 << CS00)' : '(1 << CS00)'};  // prescaler ${prescaler}`,
        `  TIMSK0 = (1 << TOIE0);`,
        `}`,
        `static inline unsigned long millis() {`,
        `  unsigned long m; uint8_t oldSREG = SREG; cli();`,
        `  m = _tc_millis_count * ${prescaler}UL * 256UL / (F_CPU / 1000000UL);`,
        `  SREG = oldSREG; return m;`,
        `}`,
        `static inline unsigned long micros() {`,
        `  unsigned long m; uint8_t t; uint8_t oldSREG = SREG; cli();`,
        `  m = _tc_millis_count; t = TCNT0;`,
        `  if ((TIFR0 & _BV(TOV0)) && t < 255) m++;`,
        `  SREG = oldSREG;`,
        `  return ((m << 8) + t) * (${prescaler}UL / (F_CPU / 1000000UL));`,
        `}`,
        `#else`,
        `// Arduino core is linked: it provides millis()/micros() and the Timer0`,
        `// ISR. _init_millis() is a no-op since the core's main() already set up`,
        `// Timer0 before calling setup().`,
        `static inline void _init_millis() {}`,
        `#endif`,
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

    // ── Native SPI driver — SPCR/SPSR/SPDR registers (no Arduino SPI lib) ──
    lines.push(
      '#ifndef ARDUINO',
      '// Native SPI driver — ATmega328P SPI master mode.',
      'static inline void _spi_init() {',
      '  // Enable SPI, Master mode, F_CPU/4 clock (SPR0=SPR1=0).',
      '  DDRB |= (1 << 5) | (1 << 3) | (1 << 2);  // MOSI, SCK, /SS as outputs',
      '  DDRB &= ~(1 << 4);  // MISO as input',
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
      '  // mode: 0=CPOL0/CPHA0, 1=CPOL0/CPHA1, 2=CPOL1/CPHA0, 3=CPOL1/CPHA1',
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
      '  (void)settings;  // SPISettings applied via set_mode/set_bit_order',
      '}',
      '#endif',
      ''
    );

    // ── Native UART extensions — print expressions, peek, flush ──────────
    // The base _uart_* helpers (init/write/read/available/print/println) are
    // already emitted above. These add expression-printing (for uart.print
    // with numeric values), peek, and flush.
    lines.push(
      '#ifndef ARDUINO',
      '// Print a numeric/string expression via UART (template handles all types).',
      'template<typename T> inline void _uart_print_expr(T val) {',
      '  _uart_print_long((long)val);',
      '}',
      'inline void _uart_print_expr(const char* s) { _uart_print(s); }',
      'inline void _uart_print_expr(char c) { _uart_write(c); }',
      'inline void _uart_print_expr(float f) { _uart_print_float(f); }',
      'inline void _uart_print_expr(double f) { _uart_print_float(f); }',
      'inline void _uart_print_expr(bool b) { _uart_println(b ? "true" : "false"); }',
      '',
      'template<typename T> inline void _uart_println_expr(T val) {',
      '  _uart_print_long((long)val); _uart_write(\'\\r\'); _uart_write(\'\\n\');',
      '}',
      'inline void _uart_println_expr(const char* s) { _uart_println(s); }',
      'inline void _uart_println_expr(float f) { _uart_print_float(f); _uart_write(\'\\r\'); _uart_write(\'\\n\'); }',
      '',
      'static inline int _uart_peek() {',
      '  return (UCSR0A & (1 << RXC0)) ? UDR0 : -1;',
      '}',
      '',
      'static inline void _uart_flush() {',
      '  while (!(UCSR0A & (1 << UDRE0)));  // wait for TX buffer empty',
      '}',
      '#endif',
      ''
    );

    // Native tone() driver — Timer2 CTC mode toggling the output-compare pin
    // at the desired frequency. Guarded with #ifndef ARDUINO so the Arduino
    // core's tone()/noTone() (Tone.cpp) are used when the core is linked.
    // Emitted unconditionally (small, only linked if _tc_tone_play is called).
    lines.push(
      '#ifndef ARDUINO',
      '// Native tone driver — Timer2 CTC mode.',
      'static volatile unsigned long _tc_tone_end = 0;',
      'static volatile bool _tc_tone_active = false;',
      'static volatile uint8_t _tc_tone_pin = 0;',
      '',
      'static void _tc_tone_stop_inline(void) {',
      '  TCCR2B = 0;  // stop timer',
      '  _tc_tone_active = false;',
      '}',
      '',
      'static void _tc_tone_play(uint8_t pin, unsigned long freq, unsigned long duration) {',
      '  if (freq == 0) { _tc_tone_stop_inline(); return; }',
      '  _tc_tone_pin = pin;',
      '  // CTC mode, toggle OC2A on compare match.',
      '  TCCR2A = (1 << COM2A0) | (1 << WGM21);',
      '  // OCR2A = F_CPU / (2 * prescaler * freq) - 1',
      '  // Try prescalers to find one that fits OCR2A < 255.',
      '  const unsigned long prescalers[] = {1, 8, 32, 64, 128, 256, 1024};',
      '  const uint8_t cs_bits[] = {(1<<CS20), (1<<CS21), (1<<CS21)|(1<<CS20), (1<<CS22), (1<<CS22)|(1<<CS20), (1<<CS22)|(1<<CS21), (1<<CS22)|(1<<CS21)|(1<<CS20)};',
      '  for (int i = 0; i < 7; i++) {',
      '    unsigned long ocr = (F_CPU / (2UL * prescalers[i] * freq)) - 1;',
      '    if (ocr < 256) {',
      '      OCR2A = (uint8_t)ocr;',
      '      TCCR2B = cs_bits[i];',
      '      break;',
      '    }',
      '  }',
      '  _tc_tone_active = true;',
      '  _tc_tone_end = (duration > 0) ? (millis() + duration) : 0;',
      '}',
      '',
      'static void _tc_tone_stop(uint8_t pin) {',
      '  (void)pin;',
      '  _tc_tone_stop_inline();',
      '}',
      '#endif',
      ''
    );

    // External interrupt handlers — data-driven from the chip descriptor.
    // Guarded with #ifndef ARDUINO so the Arduino core's ISR definitions
    // (from WInterrupts.c) are used when the core is linked, avoiding a
    // multiple-definition link error. In a bare-metal build, these provide
    // native ISR dispatch via function-pointer trampolines.
    if (usesExternalInterrupts) {
      const intPins = Object.entries(activeChip.interruptsByPin);
      if (intPins.length > 0) {
        lines.push('#ifndef ARDUINO');
        for (const [, info] of intPins) {
          lines.push(
            `static volatile void (*${info.handler})(void) = 0;`,
          );
        }
        lines.push('');
        for (const [, info] of intPins) {
          lines.push(
            `ISR(${info.vector}) { if (${info.handler}) ${info.handler}(); }`,
            '',
          );
        }
        lines.push('#endif');
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
      lines.push(...parentLines);

      // Native __tc_Timing replacement — delegates to AVR helpers, not the
      // Arduino core. freeHeap() uses the avr-libc __heap_start/__brkval trick.
      lines.push(
        '// Native __tc_Timing — delegates to AVR helpers, not Arduino core.',
        'struct __tc_Timing {',
        '    unsigned long millis() { return millis(); }',
        '    unsigned long micros() { return micros(); }',
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
  override setupInitCode(program?: ProgramIR, _ctx?: PlatformContext): string[] {
    const lines: string[] = [];

    lines.push(`_uart_init(${activeChip.uart.defaultBaud})`);

    // Start the Timer0 millis backbone before anything else — timing is
    // foundational (setInterval, delay-relative ops, and the async runtime
    // all depend on it). Enable global interrupts last.
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

    // Enable global interrupts last, so the Timer0 overflow ISR (and any
    // configured external interrupts) begin firing only after all peripheral
    // setup is complete.
    lines.push('sei()');

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
      case "pulse.in": {
        const pop = op as any;
        const target = pop.value === 1 ? 1 : 0;
        const readExpr = nativeDigitalRead(op.pin);
        const timeoutCheck = pop.timeout !== undefined
          ? `if (micros() - __start >= ${pop.timeout}) return 0;`
          : '';
        return { expression: `({ unsigned long __start = micros(); while ((${readExpr}) != ${target}) { ${timeoutCheck} } __start = micros(); while ((${readExpr}) == ${target}) { ${timeoutCheck} } micros() - __start; })` };
      }
      case "pulse.in_long": {
        // pulse.in_long is the same as pulse.in on AVR (no longer-resolution timer).
        const pop = op as any;
        const target = pop.value === 1 ? 1 : 0;
        const readExpr = nativeDigitalRead(op.pin);
        return { expression: `({ unsigned long __start = micros(); while ((${readExpr}) != ${target}) {} __start = micros(); while ((${readExpr}) == ${target}) {} micros() - __start; })` };
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
      // ── Tone — native Timer2 CTC, not Arduino tone()/noTone() ──
      case "tone.play": {
        const top = op as any;
        const freq = top.frequency;
        const dur = top.duration;
        if (dur !== undefined) {
          return { code: `_tc_tone_play(${op.pin}, ${freq}, ${dur});` };
        }
        return { code: `_tc_tone_play(${op.pin}, ${freq}, 0);` };
      }
      case "tone.stop":
        return { code: `_tc_tone_stop(${op.pin});` };
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
      // ── Invalid-on-AVR ops — no-op with a comment, not undefined symbols ──
      case "dac.write":
        return { code: `/* dac.write not supported on AVR (no DAC hardware) */;` };
      case "power.set_cpu_frequency":
        return { code: `/* set_cpu_frequency not supported on AVR */;` };
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