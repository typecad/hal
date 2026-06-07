// ---------------------------------------------------------------------------
// @typecad/arch-avr-native — Native AVR platform strategy
//
// This strategy generates direct AVR register access instead of Arduino
// framework function calls. For example:
//   D13.high()  →  PORTB |= (1 << PB5)
//   A0.read()   →  ADC register operations
// ---------------------------------------------------------------------------

import { ArduinoStrategy } from '@typecad/framework-arduino';
import type { RuntimePolyfillIR } from '@typecad/cuttlefish/api/shared';
import {
  getPinInfo,
  parsePinFromReceiver,
  getPinBitMask,
  getADCChannel,
  getPWMInfo,
  inferReceiverKind,
  getInterruptInfo,
} from './registers';

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
  } else if (mode === 'INPUT_PULLDOWN') {
    // AVR has no hardware pulldown — fall back to floating input
    return `${ddr} &= ~${mask}, ${port} &= ~${mask}`;
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
   */
  generateNativePolyfills(program?: any, _ctx?: any): RuntimePolyfillIR[] {
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
  private statementUsesConsole(stmt: any): boolean {
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
        '  ADCSRA = (1 << ADEN) | (1 << ADPS2) | (1 << ADPS1) | (1 << ADPS0);',
        '}',
        ''
      );
    }
    
    // PWM timer initialization
    if (usesPWM && pwmPinsUsed.size > 0) {
      const timersNeeded = new Set<string>();
      for (const pin of pwmPinsUsed) {
        const pwm = getPWMInfo(pin);
        if (pwm) {
          timersNeeded.add(pwm.timerId);
        }
      }
      
      lines.push('// PWM timer initialization');
      
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
    
    return lines;
  }
  
  /**
   * Generate setup initialization code based on peripheral usage.
   */
  setupInitCode(program?: any, _ctx?: any): string[] {
    const lines: string[] = [];
    
    lines.push('_uart_init(9600)');
    
    const usage = program?.peripheralUsage;
    const pwmPinsUsed: Set<number> = usage?.pwmPinsUsed ?? new Set<number>();
    const outputPins: Set<number> = usage?.outputPins ?? new Set<number>();
    const inputPullupPins: Set<number> = usage?.inputPullupPins ?? new Set<number>();
    const inputPins: Set<number> = usage?.inputPins ?? new Set<number>();
    
    // Batch pin mode configuration by port
    const portBatches = new Map<string, { outputs: number[], inputs: number[], pullups: number[] }>();
    
    for (const pin of outputPins) {
      const port = getPinInfo(pin)?.port;
      const ddr = getPinInfo(pin)?.ddr;
      if (port && ddr) {
        const key = `${ddr}:${port}`;
        if (!portBatches.has(key)) portBatches.set(key, { outputs: [], inputs: [], pullups: [] });
        portBatches.get(key)!.outputs.push(pin);
      }
    }
    
    for (const pin of inputPullupPins) {
      const port = getPinInfo(pin)?.port;
      const ddr = getPinInfo(pin)?.ddr;
      if (port && ddr) {
        const key = `${ddr}:${port}`;
        if (!portBatches.has(key)) portBatches.set(key, { outputs: [], inputs: [], pullups: [] });
        portBatches.get(key)!.pullups.push(pin);
      }
    }
    
    for (const pin of inputPins) {
      const port = getPinInfo(pin)?.port;
      const ddr = getPinInfo(pin)?.ddr;
      if (port && ddr) {
        const key = `${ddr}:${port}`;
        if (!portBatches.has(key)) portBatches.set(key, { outputs: [], inputs: [], pullups: [] });
        portBatches.get(key)!.inputs.push(pin);
      }
    }
    
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

  override symbolAliases(_program?: any, _ctx?: any): Record<string, string> {
    return {
      'delay': '_native_delay_ms',
      'delayMicroseconds': '_native_delay_us',
      'millis': 'millis',
      'micros': 'micros',
      'map': '_native_map',
      'constrain': '_native_constrain',
      'noInterrupts': 'cli',
      'interrupts': 'sei',
    };
  }

  /**
   * Core native code generation for pin method calls and Serial.
   */
   private tryRenderNativeCall(
    receiver: string,
    method: string,
    args: ReadonlyArray<any>,
    renderArg: (e: any) => string,
    boardConstants?: any,
  ): string | undefined {
    const a = (i: number) => args[i] !== undefined ? renderArg(args[i]) : '';
    
    // Handle Serial peripheral calls
    if (receiver === 'Serial') {
      switch (method) {
        case 'initialize':
        case 'begin': {
          let baud = '9600';
          if (args[0]) {
            const arg = args[0];
            if (arg.kind === 'object' && arg.fields) {
              for (const field of arg.fields) {
                if (field.name === 'baudRate') {
                  baud = renderArg(field.value);
                  break;
                }
              }
            } else {
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
        // Ownership (opt-in, single-threaded AVR = boolean flag)
        case 'take':
          return `/* ${receiver}.take() */ (!_${receiver.toLowerCase()}_owned && (_${receiver.toLowerCase()}_owned = true))`;
        case 'release':
          return `/* ${receiver}.release() */ (_${receiver.toLowerCase()}_owned = false)`;
        default:
          return undefined;
      }
    }
    
    // Handle pin configuration calls
    if (method.startsWith('config.output.')) {
      const pin = parsePinFromReceiver(receiver);
      if (pin !== null) {
        if (method === 'config.output.initial') {
          const value = a(0);
          return `${nativePinMode(pin, 'OUTPUT')}, ${nativeDigitalWrite(pin, value)}`;
        }
        return nativePinMode(pin, 'OUTPUT');
      }
    }
    
    if (method.startsWith('config.input.')) {
      const pin = parsePinFromReceiver(receiver);
      if (pin !== null) {
        if (method === 'config.inputPullUp') {
          return nativePinMode(pin, 'INPUT_PULLUP');
        } else if (method === 'config.inputPullDown') {
          return nativePinMode(pin, 'INPUT_PULLDOWN');
        } else if (method === 'config.input') {
          return nativePinMode(pin, 'INPUT');
        }
      }
    }

    if (method === 'input') {
      const pin = parsePinFromReceiver(receiver);
      if (pin !== null) {
        return nativePinMode(pin, 'INPUT');
      }
    }

    if (method === 'inputPullUp') {
      const pin = parsePinFromReceiver(receiver);
      if (pin !== null) {
        return nativePinMode(pin, 'INPUT_PULLUP');
      }
    }

    if (method === 'inputPullDown') {
      const pin = parsePinFromReceiver(receiver);
      if (pin !== null) {
        return nativePinMode(pin, 'INPUT_PULLDOWN');
      }
    }

    // Object-creation aliases (same C++ as output/input/inputPullUp, different TS return types)
    if (method === 'asOutput') {
      const pin = parsePinFromReceiver(receiver);
      if (pin !== null) {
        return nativePinMode(pin, 'OUTPUT');
      }
    }

    if (method === 'asInput') {
      const pin = parsePinFromReceiver(receiver);
      if (pin !== null) {
        return nativePinMode(pin, 'INPUT');
      }
    }

    if (method === 'asInputPullUp') {
      const pin = parsePinFromReceiver(receiver);
      if (pin !== null) {
        return nativePinMode(pin, 'INPUT_PULLUP');
      }
    }
    
    // Parse pin number from receiver
    const pin = parsePinFromReceiver(receiver);
    if (pin === null) return undefined;

    const pinKind = inferReceiverKind(pin);

    switch (pinKind) {
      case 'analog-input':
        switch (method) {
          case 'read':
            return nativeAnalogRead(pin);
          case 'readVoltage': {
            const refV = (boardConstants?.get('peripherals.adc.0.referenceVoltage') as number) ?? 5.0;
            const res = (boardConstants?.get('peripherals.adc.0.resolution') as number) ?? 10;
            const maxADC = Math.pow(2, res) - 1;
            return `(nativeAnalogRead(${pin}) * ${refV} / ${maxADC}.0)`;
          }
          case 'getResolution': {
            const res = (boardConstants?.get('peripherals.adc.0.resolution') as number) ?? 10;
            return `${res}`;
          }
          case 'setMode':
            return nativePinMode(pin, a(0));
          // Analog pins on AVR are dual-purpose (A0-A5 = D14-D19 on PORTC)
          // They CAN be used as digital I/O, but analog capability is lost.
          case 'output':
            if (args.length > 0) {
              return `${nativePinMode(pin, 'OUTPUT')}; ${nativeDigitalWrite(pin, a(0))}`;
            }
            return nativePinMode(pin, 'OUTPUT');
          case 'high':
            return `${nativePinMode(pin, 'OUTPUT')}; ${nativeDigitalWrite(pin, 'HIGH')}`;
          case 'low':
            return `${nativePinMode(pin, 'OUTPUT')}; ${nativeDigitalWrite(pin, 'LOW')}`;
          case 'input':
            return nativePinMode(pin, 'INPUT');
          case 'inputPullUp':
            return nativePinMode(pin, 'INPUT_PULLUP');
          default:
            return undefined;
        }

      case 'digital':
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
}

// ---------------------------------------------------------------------------
// Export as PlatformStrategy for architecture package convention
// ---------------------------------------------------------------------------

export { NativeAVRStrategy as PlatformStrategy };