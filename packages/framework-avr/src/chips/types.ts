// ---------------------------------------------------------------------------
// AVR chip descriptor types
//
// A chip descriptor is a pure-data description of one AVR MCU's register
// layout: how Arduino/framework pin numbers map to PORT/DDR/PIN registers,
// which timers drive PWM, which pins carry external interrupts, and the
// clock/UART/ADC configuration. Adding support for a new AVR chip should be
// authoring one of these objects — not editing strategy.ts or registers.ts.
//
// The helpers in registers.ts read off an "active" descriptor (set once by
// NativeAVRStrategy) so the rest of the package never needs to know which
// chip is selected.
// ---------------------------------------------------------------------------

/**
 * Register-level mapping for a single Arduino/framework pin number.
 */
export interface AVRPinMap {
  /** Port output register, e.g. "PORTB" */
  port: string;
  /** Data direction register, e.g. "DDRB" */
  ddr: string;
  /** Pin input register, e.g. "PINB" */
  pinReg: string;
  /** Bit position within the register (0-7) */
  bit: number;
}

/**
 * Timer-level PWM configuration, shared by every pin driven by this timer.
 */
export interface AVRTimer {
  /** Stable identifier used to group pins, e.g. "timer0" */
  id: string;
  /** Setup-time initialization statement(s), e.g. "TCCR0A |= (1 << WGM00); ..." */
  initCode: string;
}

/**
 * Per-pin PWM output-compare configuration.
 */
export interface AVRPwmPin {
  /** The timer that drives this pin (key into AVRChipDescriptor.timers). */
  timerId: string;
  /** Output compare register, e.g. "OCR0A" */
  ocr: string;
  /** Timer control register carrying the COM bit, e.g. "TCCR0A" */
  tccr: string;
  /** Compare output mode bit, e.g. "COM0A1" */
  comBit: string;
}

/**
 * Per-pin external interrupt configuration.
 */
export interface AVRInterruptPin {
  /** Interrupt identifier, e.g. "INT0" */
  interrupt: string;
  /** C symbol of the user-callback trampoline, e.g. "_int0_handler" */
  handler: string;
  /** ISR vector symbol, e.g. "INT0_vect" */
  vector: string;
}

/**
 * ADC block configuration.
 */
export interface AVRAdcConfig {
  /** Reference-selection bits ORed into ADMUX for the default reference, e.g. "(1 << REFS0)". */
  referenceBits: string;
  /** Prescaler bits written to ADCSRA, e.g. "(1 << ADPS2) | (1 << ADPS1) | (1 << ADPS0)". */
  prescalerBits: string;
  /** Arduino/framework pin number -> ADC channel number, e.g. { 14: 0, 15: 1, ... }. */
  channelsByPin: Record<number, number>;
}

/**
 * UART block configuration.
 */
export interface AVRUartConfig {
  /** USART instance label, e.g. "USART0" (informational; the register names
   *  like UBRR0H/UCSR0B are implied by the instance). */
  instance: string;
  /** Default baud rate used when the program does not specify one. */
  defaultBaud: number;
}

/**
 * Pure-data description of a supported AVR MCU.
 *
 * Author one of these per chip. The strategy and register helpers read from
 * whichever descriptor is active (see setActiveChip); nothing in the emit
 * path hardcodes chip specifics.
 */
export interface AVRChipDescriptor {
  /** Canonical id, e.g. "atmega328p". */
  id: string;
  /** CPU clock frequency in Hz. Drives F_CPU and UART baud divisor math. */
  fcpu: number;
  /** UART block. */
  uart: AVRUartConfig;
  /** ADC block. */
  adc: AVRAdcConfig;
  /** Arduino/framework pin number -> register mapping. */
  pins: Record<number, AVRPinMap>;
  /** Timers available for PWM, keyed by id. */
  timers: Record<string, AVRTimer>;
  /** PWM-capable pins, keyed by Arduino/framework pin number. */
  pwmByPin: Record<number, AVRPwmPin>;
  /** Pins carrying external interrupts, keyed by Arduino/framework pin number. */
  interruptsByPin: Record<number, AVRInterruptPin>;
  /**
   * The timer used to back millis()/micros() via an overflow ISR.
   * On classic megaAVR this is Timer0; the vector is TIM0_OVF_vect.
   */
  millisTimer: AVRMillisTimer;
}

/**
 * Configuration for the millis()/micros() backing timer.
 */
export interface AVRMillisTimer {
  /** Timer overflow ISR vector, e.g. "TIM0_OVF_vect". */
  overflowVector: string;
  /**
   * Timer prescaler divisor (e.g. 64). Combined with F_CPU and the 8-bit
   * overflow width to derive the millis/micros conversion math.
   */
  prescaler: number;
}
