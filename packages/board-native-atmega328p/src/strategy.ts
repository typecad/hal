// ---------------------------------------------------------------------------
// @typecode/board-native-atmega328p — Native AVR platform strategy
//
// This strategy generates direct AVR register access instead of Arduino
// framework function calls. For example:
//   D13.high()  →  PORTB |= (1 << PB5)
//   A0.read()   →  ADC register operations
// ---------------------------------------------------------------------------

import { ArduinoStrategy, RuntimePolyfillIR } from 'typecode/platform';

/**
 * Map Arduino pin number to AVR port register info.
 * Returns { port, ddr, pin, bit } for the given pin.
 */
function getPinInfo(pin: number): { port: string; ddr: string; pinReg: string; bit: number } | null {
  // Port D (PD0-PD7) = Arduino D0-D7
  if (pin >= 0 && pin <= 7) {
    return { port: 'PORTD', ddr: 'DDRD', pinReg: 'PIND', bit: pin };
  }
  // Port B (PB0-PB5) = Arduino D8-D13
  if (pin >= 8 && pin <= 13) {
    return { port: 'PORTB', ddr: 'DDRB', pinReg: 'PINB', bit: pin - 8 };
  }
  // Port C (PC0-PC5) = Arduino A0-A5 (D14-D19)
  if (pin >= 14 && pin <= 19) {
    return { port: 'PORTC', ddr: 'DDRC', pinReg: 'PINC', bit: pin - 14 };
  }
  return null;
}

/**
 * Extract pin number from receiver name (e.g., "D13" -> 13, "A0" -> 14).
 */
function parsePinFromReceiver(receiver: string): number | null {
  if (receiver === 'LED') return 13;
  if (receiver.startsWith('D')) {
    const num = parseInt(receiver.slice(1), 10);
    return isNaN(num) ? null : num;
  }
  if (receiver.startsWith('A')) {
    const num = parseInt(receiver.slice(1), 10);
    return isNaN(num) ? null : 14 + num;
  }
  return null;
}

/**
 * Get ADC channel for analog pin.
 */
function getADCChannel(pin: number): number | null {
  if (pin >= 14 && pin <= 19) {
    return pin - 14;
  }
  return null;
}

/**
 * Get PWM timer info for PWM-capable pins.
 * Returns { ocr, tccr, comBit, prescaler, timerId, wgmBits } or null if not PWM-capable.
 * timerId is used to group pins by timer for batch initialization.
 */
function getPWMInfo(pin: number): { ocr: string; tccr: string; comBit: string; prescaler: string; timerId: string; wgmBits: string } | null {
  const pwmMap: Record<number, { ocr: string; tccr: string; comBit: string; prescaler: string; timerId: string; wgmBits: string }> = {
    // Timer0 (8-bit) - pins 5 and 6
    5:  { ocr: 'OCR0B', tccr: 'TCCR0A', comBit: 'COM0B1', prescaler: 'TCCR0B |= (1 << CS01) | (1 << CS00)', timerId: 'timer0', wgmBits: '(1 << WGM00)' },
    6:  { ocr: 'OCR0A', tccr: 'TCCR0A', comBit: 'COM0A1', prescaler: 'TCCR0B |= (1 << CS01) | (1 << CS00)', timerId: 'timer0', wgmBits: '(1 << WGM00)' },
    // Timer1 (16-bit) - pins 9 and 10
    9:  { ocr: 'OCR1A', tccr: 'TCCR1A', comBit: 'COM1A1', prescaler: 'TCCR1B |= (1 << CS11)', timerId: 'timer1', wgmBits: '(1 << WGM10)' },
    10: { ocr: 'OCR1B', tccr: 'TCCR1A', comBit: 'COM1B1', prescaler: 'TCCR1B |= (1 << CS11)', timerId: 'timer1', wgmBits: '(1 << WGM10)' },
    // Timer2 (8-bit) - pins 3 and 11
    3:  { ocr: 'OCR2B', tccr: 'TCCR2A', comBit: 'COM2B1', prescaler: 'TCCR2B |= (1 << CS22)', timerId: 'timer2', wgmBits: '(1 << WGM20)' },
    11: { ocr: 'OCR2A', tccr: 'TCCR2A', comBit: 'COM2A1', prescaler: 'TCCR2B |= (1 << CS22)', timerId: 'timer2', wgmBits: '(1 << WGM20)' },
  };
  return pwmMap[pin] || null;
}

/**
 * Get pre-computed bit mask for a pin (avoids runtime shift).
 */
function getPinBitMask(pin: number): string {
  const info = getPinInfo(pin);
  if (!info) return '0';
  return `0x${(1 << info.bit).toString(16).toUpperCase()}`;
}

/**
 * Get port register name for a pin.
 */
function getPortReg(pin: number): string | null {
  const info = getPinInfo(pin);
  return info?.port ?? null;
}

/**
 * Get DDR register name for a pin.
 */
function getDDRReg(pin: number): string | null {
  const info = getPinInfo(pin);
  return info?.ddr ?? null;
}

// ---------------------------------------------------------------------------
// Native AVR code generation functions
// ---------------------------------------------------------------------------

/**
 * Generate native pinMode code with pre-computed bit mask.
 */
function nativePinMode(pin: number, mode: string): string {
  const info = getPinInfo(pin);
  if (!info) return `/* invalid pin ${pin} */`;
  
  const { ddr, port, bit } = info;
  const mask = getPinBitMask(pin);  // Pre-computed hex constant
  
  if (mode === 'OUTPUT' || mode === '1') {
    return `${ddr} |= ${mask}`;
  } else if (mode === 'INPUT_PULLUP' || mode === '2') {
    return `${ddr} &= ~${mask}, ${port} |= ${mask}`;
  } else { // INPUT
    return `${ddr} &= ~${mask}, ${port} &= ~${mask}`;
  }
}

/**
 * Generate native digitalWrite code with pre-computed bit mask.
 */
function nativeDigitalWrite(pin: number, value: string): string {
  const info = getPinInfo(pin);
  if (!info) return `/* invalid pin ${pin} */`;
  
  const { port, bit } = info;
  const mask = getPinBitMask(pin);  // Pre-computed hex constant
  
  if (value === 'HIGH' || value === '1' || value === 'true') {
    return `${port} |= ${mask}`;
  } else if (value === 'LOW' || value === '0' || value === 'false') {
    return `${port} &= ~${mask}`;
  } else {
    // Dynamic value - use ternary
    return `(${value}) ? (${port} |= ${mask}) : (${port} &= ~${mask})`;
  }
}

/**
 * Generate native digitalRead expression with pre-computed bit mask.
 */
function nativeDigitalRead(pin: number): string {
  const info = getPinInfo(pin);
  if (!info) return `0 /* invalid pin ${pin} */`;
  
  const { pinReg, bit } = info;
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
    `ADMUX = (1 << REFS0) | ${channel}; ` +  // AVcc reference, select channel
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

/**
 * Generate PWM timer initialization code for a specific timer.
 * This is called once per timer used, emitted in setup().
 */
function generatePWMTimerInit(timerId: string): string {
  switch (timerId) {
    case 'timer0':
      // Timer0: 8-bit PWM, prescaler 64 (976Hz at 16MHz)
      return 'TCCR0A |= (1 << WGM00); TCCR0B |= (1 << CS01) | (1 << CS00);';
    case 'timer1':
      // Timer1: 8-bit PWM, prescaler 8 (7.8kHz at 16MHz)
      return 'TCCR1A |= (1 << WGM10); TCCR1B |= (1 << CS11);';
    case 'timer2':
      // Timer2: 8-bit PWM, prescaler 64 (976Hz at 16MHz)
      return 'TCCR2A |= (1 << WGM20); TCCR2B |= (1 << CS22);';
    default:
      return `/* unknown timer: ${timerId} */`;
  }
}

/**
 * Generate PWM output enable code for a pin.
 * This enables the PWM output on a specific pin (COMxx1 bit).
 */
function generatePWMOutputEnable(pin: number): string {
  const pwm = getPWMInfo(pin);
  if (!pwm) return '';
  const { tccr, comBit, wgmBits } = pwm;
  return `${tccr} |= (1 << ${comBit}) | ${wgmBits};`;
}

/**
 * Infer receiver kind from pin number.
 * Returns 'analog-input' for A0-A5, 'pwm' for PWM-capable pins, 'digital' otherwise.
 */
function inferReceiverKind(pin: number): 'analog-input' | 'digital' | 'pwm' {
  // A0-A5 are analog inputs (pins 14-19 in Arduino numbering)
  if (pin >= 14 && pin <= 19) return 'analog-input';
  // PWM-capable pins: 3, 5, 6, 9, 10, 11
  if (pin === 3 || pin === 5 || pin === 6 || pin === 9 || pin === 10 || pin === 11) return 'pwm';
  // All other pins are digital
  return 'digital';
}

// ---------------------------------------------------------------------------
// NativeStrategy class
// ---------------------------------------------------------------------------

/**
 * Platform strategy for native ATmega328P code generation.
 *
 * Generates direct AVR register access instead of Arduino framework calls.
 * This strategy overrides the default "arduino" strategy to generate native code.
 */
export class NativeStrategy extends ArduinoStrategy {
  // Override the ID to replace the default arduino strategy
  override readonly id = "arduino";

  // ── Includes ────────────────────────────────────────────────────────────

  override forcedIncludes(_program?: any, _ctx?: any): string[] {
    // Only avr/io.h here - util/delay.h needs F_CPU defined first
    return [
      '<avr/io.h>',
    ];
  }

  // ── Polyfill overrides ──────────────────────────────────────────────────

  /**
   * This strategy provides native implementations for console.log.
   * The emitter will skip emitting the global console polyfill.
   */
  nativePolyfills(): Set<string> {
    return new Set(['console']);
  }

  /**
   * Generate native console polyfill using UART functions.
   * This provides overloaded console_log functions for all types.
   */
  generateNativePolyfills(program?: any, _ctx?: any): RuntimePolyfillIR[] {
    // Check if console is used in the program
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
  private detectConsoleUsage(program?: any): boolean {
    if (!program) return false;
    
    // Check for console usage in functions
    for (const fn of program.functions ?? []) {
      for (const stmt of fn.statements ?? []) {
        if (this.statementUsesConsole(stmt)) {
          return true;
        }
      }
    }
    
    // Check top-level statements
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
  private statementUsesConsole(stmt: any): boolean {
    if (!stmt) return false;
    if (stmt.kind === 'call') {
      const callee = stmt.callee ?? '';
      // Check for original console.* calls
      if (callee.startsWith('console.')) {
        return true;
      }
      // Also check for transformed _uart_* calls that come from console
      if (callee === '_uart_println' || callee === '_uart_print' ||
          callee === '_uart_println_long' || callee === '_uart_print_float') {
        return true;
      }
    }
    // Recursively check nested statements
    if (stmt.statements) {
      for (const nested of stmt.statements) {
        if (this.statementUsesConsole(nested)) {
          return true;
        }
      }
    }
    return false;
  }

  override shimLines(program?: any, _ctx?: any): string[] {
    const lines: string[] = [];
    
    // F_CPU must be defined before including util/delay.h
    lines.push(
      '#ifndef F_CPU',
      '#define F_CPU 16000000UL  // 16 MHz clock frequency',
      '#endif',
      '#include <util/delay.h>',
      '#include <avr/interrupt.h>',
      ''
    );
    
    // Get peripheral usage from program IR (if available)
    const usage = program?.peripheralUsage;
    const usesADC = usage?.adc ?? false;
    const usesPWM = usage?.pwm ?? false;
    const usesExternalInterrupts = usage?.externalInterrupts ?? false;
    // Always include UART functions since we translate Serial.* calls to _uart_* functions
    // The peripheral usage detection may not catch all Serial usage patterns
    const usesUART = true; // usage?.uart ?? false;
    const pwmPinsUsed = usage?.pwmPinsUsed ?? new Set<number>();
    
    // UART initialization and helper functions (always include for native strategy)
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
        '// Check if data available to read',
        'static inline int _uart_available() {',
        '  return (UCSR0A & (1 << RXC0)) ? 1 : 0;',
        '}',
        '',
        '// Read a single byte (blocking)',
        'static inline int _uart_read() {',
        '  while (!(UCSR0A & (1 << RXC0)));',
        '  return UDR0;',
        '}',
        '',
        '// Write a single byte (blocking)',
        'static inline void _uart_write(unsigned char data) {',
        '  while (!(UCSR0A & (1 << UDRE0)));',
        '  UDR0 = data;',
        '}',
        '',
        '// Print a null-terminated string',
        'static inline void _uart_print(const char* str) {',
        '  while (*str) _uart_write(*str++);',
        '}',
        '',
        '// Print string with newline',
        'static inline void _uart_println(const char* str) {',
        '  _uart_print(str);',
        '  _uart_write(\'\\r\');',
        '  _uart_write(\'\\n\');',
        '}',
        '',
        '// Print a long integer',
        'static inline void _uart_print_long(long num) {',
        '  char buf[12];',
        '  ltoa(num, buf, 10);',
        '  _uart_print(buf);',
        '}',
        '',
        '// Print a long integer with newline',
        'static inline void _uart_println_long(long num) {',
        '  _uart_print_long(num);',
        '  _uart_write(\'\\r\');',
        '  _uart_write(\'\\n\');',
        '}',
        '',
        '// Print a float (2 decimal places)',
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
      
      // Note: console.log polyfill is handled by the Arduino polyfill system
      // which emits inline functions that use Serial.println()
      // Serial.println() calls are translated to _uart_println() by translateTypecodeCall
      // So console.log will ultimately use native UART through the translation layer
    }
    
    // ADC initialization (only if analog reads are used)
    if (usesADC) {
      lines.push(
        '// ADC initialization (generated once at compile time)',
        'static inline void _init_adc() {',
        '  ADCSRA = (1 << ADEN) | (1 << ADPS2) | (1 << ADPS1) | (1 << ADPS0);',
        '}',
        ''
      );
    }
    
    // PWM timer initialization (only for timers that are used)
    if (usesPWM && pwmPinsUsed.size > 0) {
      // Determine which timers are needed
      const timersNeeded = new Set<string>();
      for (const pin of pwmPinsUsed) {
        const pwm = getPWMInfo(pin);
        if (pwm) {
          timersNeeded.add(pwm.timerId);
        }
      }
      
      lines.push('// PWM timer initialization (generated once at compile time)');
      
      if (timersNeeded.has('timer0')) {
        lines.push(
          'static inline void _init_pwm_timer0() {',
          '  TCCR0A |= (1 << WGM00); TCCR0B |= (1 << CS01) | (1 << CS00);',
          '}',
          ''
        );
      }
      if (timersNeeded.has('timer1')) {
        lines.push(
          'static inline void _init_pwm_timer1() {',
          '  TCCR1A |= (1 << WGM10); TCCR1B |= (1 << CS11);',
          '}',
          ''
        );
      }
      if (timersNeeded.has('timer2')) {
        lines.push(
          'static inline void _init_pwm_timer2() {',
          '  TCCR2A |= (1 << WGM20); TCCR2B |= (1 << CS22);',
          '}',
          ''
        );
      }
    }
    
    // Native delay functions using AVR libc
    lines.push(
      'static inline void _native_delay_ms(unsigned long ms) { while (ms--) _delay_ms(1); }',
      'static inline void _native_delay_us(unsigned int us) { while (us--) _delay_us(1); }',
      ''
    );
    
    // Optimized map() function with power-of-2 fast path
    lines.push(
      '// Optimized map: uses bit shifts when ranges are power-of-2',
      'static inline long _native_map(long x, long in_min, long in_max, long out_min, long out_max) {',
      '  // Check for power-of-2 ranges (common case: 0-1023 -> 0-255)',
      '  if (in_min == 0 && out_min == 0) {',
      '    long in_range = in_max - in_min + 1;',
      '    long out_range = out_max - out_min + 1;',
      '    // 1024/256 = 4, so >> 2',
      '    if (in_range == 1024 && out_range == 256) return x >> 2;',
      '    // 1024/128 = 8, so >> 3',
      '    if (in_range == 1024 && out_range == 128) return x >> 3;',
      '    // 256/1024 = 1/4, so << 2 (with bounds check)',
      '    if (in_range == 256 && out_range == 1024) { long r = x << 2; return r > 1023 ? 1023 : r; }',
      '  }',
      '  // Generic case',
      '  return (x - in_min) * (out_max - out_min) / (in_max - in_min) + out_min;',
      '}',
      ''
    );
    
    // Native constrain() function
    lines.push(
      'static inline long _native_constrain(long x, long a, long b) {',
      '  return (x < a) ? a : ((x > b) ? b : x);',
      '}',
      ''
    );
    
    // External interrupt handlers (only if attachInterrupt is used)
    if (usesExternalInterrupts) {
      lines.push(
        '// External interrupt handler storage',
        'static volatile void (*_int0_handler)(void) = 0;',
        'static volatile void (*_int1_handler)(void) = 0;',
        '',
        'ISR(INT0_vect) { if (_int0_handler) _int0_handler(); }',
        '',
        'ISR(INT1_vect) { if (_int1_handler) _int1_handler(); }',
        ''
      );
    }
    
    return lines;
  }
  
  /**
   * Generate setup initialization code based on peripheral usage.
   * This is called to generate code that runs once at startup.
   */
  setupInitCode(program?: any, _ctx?: any): string[] {
    const lines: string[] = [];
    
    // Always initialize UART for native board package (used for console and Serial)
    lines.push('_uart_init(9600)');
    
    const usage = program?.peripheralUsage;
    const pwmPinsUsed: Set<number> = usage?.pwmPinsUsed ?? new Set<number>();
    const outputPins: Set<number> = usage?.outputPins ?? new Set<number>();
    const inputPullupPins: Set<number> = usage?.inputPullupPins ?? new Set<number>();
    const inputPins: Set<number> = usage?.inputPins ?? new Set<number>();
    
    // Batch pin mode configuration by port
    // Group pins by port for batch DDR/PORT operations
    const portBatches = new Map<string, { outputs: number[], inputs: number[], pullups: number[] }>();
    
    for (const pin of outputPins) {
      const port = getPortReg(pin);
      const ddr = getDDRReg(pin);
      if (port && ddr) {
        const key = `${ddr}:${port}`;
        if (!portBatches.has(key)) portBatches.set(key, { outputs: [], inputs: [], pullups: [] });
        portBatches.get(key)!.outputs.push(pin);
      }
    }
    
    for (const pin of inputPullupPins) {
      const port = getPortReg(pin);
      const ddr = getDDRReg(pin);
      if (port && ddr) {
        const key = `${ddr}:${port}`;
        if (!portBatches.has(key)) portBatches.set(key, { outputs: [], inputs: [], pullups: [] });
        portBatches.get(key)!.pullups.push(pin);
      }
    }
    
    for (const pin of inputPins) {
      const port = getPortReg(pin);
      const ddr = getDDRReg(pin);
      if (port && ddr) {
        const key = `${ddr}:${port}`;
        if (!portBatches.has(key)) portBatches.set(key, { outputs: [], inputs: [], pullups: [] });
        portBatches.get(key)!.inputs.push(pin);
      }
    }
    
    // Generate batched DDR/PORT operations
    for (const [key, pins] of portBatches) {
      const [ddr, port] = key.split(':');
      
      // Batch output configuration
      if (pins.outputs.length > 0) {
        const mask = pins.outputs.map(p => getPinBitMask(p)).join(' | ');
        if (pins.outputs.length === 1) {
          lines.push(`${ddr} |= ${mask};  // D${pins.outputs[0]} as output`);
        } else {
          const pinList = pins.outputs.map(p => `D${p}`).join(', ');
          lines.push(`${ddr} |= ${mask};  // ${pinList} as outputs`);
        }
      }
      
      // Batch input with pullup configuration
      if (pins.pullups.length > 0) {
        const ddrMask = pins.pullups.map(p => getPinBitMask(p)).join(' | ');
        const portMask = pins.pullups.map(p => getPinBitMask(p)).join(' | ');
        const pinList = pins.pullups.map(p => `D${p}`).join(', ');
        lines.push(`${ddr} &= ~(${ddrMask});  // ${pinList} as inputs`);
        lines.push(`${port} |= ${portMask};  // ${pinList} pullup enabled`);
      }
      
      // Batch input without pullup configuration
      if (pins.inputs.length > 0) {
        const ddrMask = pins.inputs.map(p => getPinBitMask(p)).join(' | ');
        const portMask = pins.inputs.map(p => getPinBitMask(p)).join(' | ');
        const pinList = pins.inputs.map(p => `D${p}`).join(', ');
        lines.push(`${ddr} &= ~(${ddrMask});  // ${pinList} as inputs`);
        lines.push(`${port} &= ~(${portMask});  // ${pinList} no pullup`);
      }
    }
    
    // Initialize ADC if analog reads are used
    if (usage?.adc) {
      lines.push('_init_adc()');
    }
    
    // Initialize PWM timers and enable outputs for pins used
    if (usage?.pwm && pwmPinsUsed.size > 0) {
      // Determine which timers are needed
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
      
      // Initialize each timer once
      for (const timerId of timersNeeded) {
        lines.push(`_init_pwm_${timerId}();  // Initialize PWM ${timerId}`);
      }
      
      // Enable PWM output on each pin
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

  // ── Symbol aliases for timing functions ─────────────────────────────────

  override symbolAliases(_program?: any, _ctx?: any): Record<string, string> {
    // Map timing functions:
    // - delay/delayMicroseconds: use native AVR libc implementations
    // - millis/micros: use Arduino framework (it already has Timer0 ISR)
    // - map/constrain: use native inline implementations
    return {
      'delay': '_native_delay_ms',
      'delayMicroseconds': '_native_delay_us',
      'millis': 'millis',  // Use Arduino's millis() - avoids Timer0 ISR conflict
      'micros': 'micros',  // Use Arduino's micros() - avoids Timer0 ISR conflict
      'map': '_native_map',
      'constrain': '_native_constrain',
      'noInterrupts': 'cli',
      'interrupts': 'sei',
    };
  }

  // ── Statement rendering ─────────────────────────────────────────────────

  /**
   * Override call statement rendering to handle pin.method() calls and timing functions.
   * This handles standalone statements like D13.high() and delay(500).
   */
  override tryRenderCallStatement(
    callee: string,
    args: ReadonlyArray<any>,
    renderArg: (e: any) => string,
    _boardConstants?: any,
  ): string | undefined {
    // Handle timing function calls
    if (callee === 'delay') {
      return `_native_delay_ms(${args.map(renderArg).join(', ')})`;
    }
    if (callee === 'delayMicroseconds') {
      return `_native_delay_us(${args.map(renderArg).join(', ')})`;
    }
    // millis() and micros() use Arduino framework to avoid Timer0 ISR conflict
    if (callee === 'millis') {
      return `millis()`;
    }
    if (callee === 'micros') {
      return `micros()`;
    }
    if (callee === 'map') {
      const a = args.map(renderArg);
      return `_native_map(${a[0]}, ${a[1]}, ${a[2]}, ${a[3]}, ${a[4]})`;
    }
    if (callee === 'constrain') {
      const a = args.map(renderArg);
      return `_native_constrain(${a[0]}, ${a[1]}, ${a[2]})`;
    }
    if (callee === 'noInterrupts') {
      return `cli()`;
    }
    if (callee === 'interrupts') {
      return `sei()`;
    }
    // Handle attachInterrupt(pin, handler, mode)
    if (callee === 'attachInterrupt') {
      const a = args.map(renderArg);
      const pin = a[0];
      const handler = a[1];
      const mode = a[2];
      // Map pin to interrupt number (D2=INT0, D3=INT1)
      // Map mode to EICRA bits
      return `({ ` +
        `_init_timer0(); ` +  // Ensure interrupts are set up
        `if (${pin} == 2) { ` +
          `_int0_handler = ${handler}; ` +
          `EICRA = (EICRA & ~0x03) | (${mode} << 0); ` +
          `EIMSK |= (1 << INT0); ` +
        `} else if (${pin} == 3) { ` +
          `_int1_handler = ${handler}; ` +
          `EICRA = (EICRA & ~0x0C) | (${mode} << 2); ` +
          `EIMSK |= (1 << INT1); ` +
        `} ` +
      `})`;
    }
    // Handle detachInterrupt(pin)
    if (callee === 'detachInterrupt') {
      const pin = args.map(renderArg)[0];
      return `({ ` +
        `if (${pin} == 2) { ` +
          `EIMSK &= ~(1 << INT0); ` +
          `_int0_handler = 0; ` +
        `} else if (${pin} == 3) { ` +
          `EIMSK &= ~(1 << INT1); ` +
          `_int1_handler = 0; ` +
        `} ` +
      `})`;
    }

    // Parse callee like "D13.high" or "A0.read"
    const parts = callee.split('.');
    let receiver: string;
    let method: string;

    if (parts.length === 2) {
      [receiver, method] = parts as [string, string];
    } else if (parts.length === 3 && (parts[0] === 'Board' || parts[0] === 'Pins')) {
      [, receiver, method] = parts as [string, string, string];
    } else {
      return undefined;
    }

    // Try to render using our native implementation
    const result = this.tryRenderNativeCall(receiver, method, args, renderArg);
    return result;
  }

  // ── Typecode call rendering ─────────────────────────────────────────────

  /**
   * Translate typecode method calls to native AVR register operations.
   * This is the core method that generates native code instead of Arduino calls.
   */
  override tryRenderTypecodeCall(
    receiver: string,
    receiverKind: string,
    method: string,
    args: ReadonlyArray<any>,
    renderArg: (e: any) => string,
    _boardConstants?: any,
  ): string | undefined {
    // Delegate to our native call renderer
    return this.tryRenderNativeCall(receiver, method, args, renderArg);
  }

  /**
   * Core native code generation for pin method calls and Serial.
   */
  private tryRenderNativeCall(
    receiver: string,
    method: string,
    args: ReadonlyArray<any>,
    renderArg: (e: any) => string,
  ): string | undefined {
    // Helper to get rendered argument
    const a = (i: number) => args[i] !== undefined ? renderArg(args[i]) : '';
    
    // Handle Serial peripheral calls
    if (receiver === 'Serial') {
      switch (method) {
        case 'initialize':
        case 'begin': {
          // Extract baud rate from config object or direct argument
          let baud = '9600';
          if (args[0]) {
            const arg = args[0];
            // Check if it's a config object with baudRate property
            if (arg.kind === 'object' && arg.fields) {
              for (const field of arg.fields) {
                if (field.name === 'baudRate') {
                  baud = renderArg(field.value);
                  break;
                }
              }
            } else {
              // Direct baud rate argument
              baud = a(0);
            }
          }
          return `_uart_init(${baud})`;
        }
        case 'print':
          return `_uart_print(${a(0)})`;
        case 'println':
          return args.length > 0 ? `_uart_println(${a(0)})` : '_uart_println("")';
        case 'printInt':
        case 'printNumber':
          return `_uart_print_long(${a(0)})`;
        case 'printlnInt':
        case 'printlnNumber':
          return `_uart_println_long(${a(0)})`;
        case 'available':
          return '_uart_available()';
        case 'read':
          return '_uart_read()';
        case 'write':
          return `_uart_write(${a(0)})`;
        case 'flush':
          return '/* UART flush: wait for TX complete */ (void)0';
        default:
          return undefined;
      }
    }
    
    // Parse pin number from receiver
    const pin = parsePinFromReceiver(receiver);
    if (pin === null) return undefined;

    // Infer receiver kind from pin number
    const receiverKind = inferReceiverKind(pin);

    // Handle based on receiver kind
    switch (receiverKind) {
      case 'analog-input':
        // A0-A5 analog input pins
        switch (method) {
          case 'read':
            return nativeAnalogRead(pin);
          case 'readVoltage':
            return `(nativeAnalogRead(${pin}) * 5.0 / 1023.0)`;
          case 'getResolution':
            return '10';
          case 'asInput':
            return nativePinMode(pin, 'INPUT');
          case 'setMode':
            return nativePinMode(pin, a(0));
          default:
            return undefined;
        }

      case 'digital':
        // D0-D13 digital pins (non-PWM)
        switch (method) {
          case 'read':
            return nativeDigitalRead(pin);
          case 'high':
            return nativeDigitalWrite(pin, 'HIGH');
          case 'low':
            return nativeDigitalWrite(pin, 'LOW');
          case 'toggle': {
            const info = getPinInfo(pin);
            if (!info) return undefined;
            return `${info.port} ^= (1 << ${info.bit})`;
          }
          case 'write':
            return nativeDigitalWrite(pin, a(0));
          case 'asOutput':
            return nativePinMode(pin, 'OUTPUT');
          case 'asInput':
            return nativePinMode(pin, 'INPUT');
          case 'asInputPullUp':
            return nativePinMode(pin, 'INPUT_PULLUP');
          case 'isHigh':
            return `(${nativeDigitalRead(pin)} == 1)`;
          case 'isLow':
            return `(${nativeDigitalRead(pin)} == 0)`;
          case 'setMode':
            return nativePinMode(pin, a(0));
          default:
            return undefined;
        }

      case 'pwm':
        // PWM-capable pins: D3, D5, D6, D9, D10, D11
        switch (method) {
          case 'read':
            return nativeDigitalRead(pin);
          case 'high':
            return nativeDigitalWrite(pin, 'HIGH');
          case 'low':
            return nativeDigitalWrite(pin, 'LOW');
          case 'toggle': {
            const info = getPinInfo(pin);
            if (!info) return undefined;
            return `${info.port} ^= (1 << ${info.bit})`;
          }
          case 'write':
            return nativeAnalogWrite(pin, a(0));
          case 'setDutyCycle':
            return nativeAnalogWrite(pin, a(0));
          case 'asOutput':
            return nativePinMode(pin, 'OUTPUT');
          case 'asInput':
            return nativePinMode(pin, 'INPUT');
          case 'asInputPullUp':
            return nativePinMode(pin, 'INPUT_PULLUP');
          case 'isHigh':
            return `(${nativeDigitalRead(pin)} == 1)`;
          case 'isLow':
            return `(${nativeDigitalRead(pin)} == 0)`;
          case 'getResolution':
            return '8';
          default:
            return undefined;
        }

      default:
        return undefined;
    }
  }
  
  // ── Console output transformation ─────────────────────────────────────────
  
  /**
   * Transform console.log/error/warn calls to native UART output.
   * This overrides the Arduino strategy to use native UART functions.
   */
  override transformConsoleCall(
    method: string,
    renderedArgs: string,
    forHeader: boolean,
  ): string {
    const semi = forHeader ? "" : ";";
    switch (method) {
      case 'log':
        // console.log(msg) → _uart_println(msg);
        return `_uart_println(${renderedArgs})${semi}`;
      case 'error':
        // console.error(msg) → _uart_print("[ERROR] "); _uart_println(msg);
        return `_uart_print("[ERROR] "); _uart_println(${renderedArgs})${semi}`;
      case 'warn':
        // console.warn(msg) → _uart_print("[WARN] "); _uart_println(msg);
        return `_uart_print("[WARN] "); _uart_println(${renderedArgs})${semi}`;
      default:
        return `_uart_println(${renderedArgs})${semi}`;
    }
  }
}

// ---------------------------------------------------------------------------
// Export as BoardStrategy for board package convention
// ---------------------------------------------------------------------------

export { NativeStrategy as BoardStrategy };
