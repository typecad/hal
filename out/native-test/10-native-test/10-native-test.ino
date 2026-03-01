
// ---- entry sketch ----
#include <avr/io.h>

#ifndef F_CPU
#define F_CPU 16000000UL  // 16 MHz clock frequency
#endif
#include <util/delay.h>
#include <avr/interrupt.h>

static volatile unsigned long _timer0_overflow_count = 0;
static volatile unsigned long _timer0_millis = 0;

ISR(TIMER0_OVF_vect) {
  _timer0_overflow_count++;
  _timer0_millis += 4;  // Each overflow = 4ms at 16MHz with prescaler 64
}

static inline void _init_timer0() {
  if (!(TCCR0B & (1 << CS01))) {
    TCCR0A = 0;  // Normal mode
    TCCR0B = (1 << CS01) | (1 << CS00);  // Prescaler 64
    TIMSK0 = (1 << TOIE0);  // Enable overflow interrupt
    sei();  // Enable global interrupts
  }
}

static inline void _native_delay_ms(unsigned long ms) { while (ms--) _delay_ms(1); }
static inline void _native_delay_us(unsigned int us) { while (us--) _delay_us(1); }

static inline unsigned long _native_millis() {
  unsigned long m;
  uint8_t oldSREG = SREG;
  cli();
  m = _timer0_millis;
  SREG = oldSREG;
  return m;
}

static inline unsigned long _native_micros() {
  unsigned long m, t;
  uint8_t oldSREG = SREG;
  cli();
  t = TCNT0;
  if ((TIFR0 & (1 << TOV0)) && (t < 255)) m = _timer0_overflow_count + 1;
  else m = _timer0_overflow_count;
  SREG = oldSREG;
  return ((m << 8) + t) * 4;  // 4us per timer tick at 16MHz/64
}

static inline long _native_map(long x, long in_min, long in_max, long out_min, long out_max) {
  return (x - in_min) * (out_max - out_min) / (in_max - in_min) + out_min;
}

static inline long _native_constrain(long x, long a, long b) {
  return (x < a) ? a : ((x > b) ? b : x);
}

static volatile void (*_int0_handler)(void) = 0;
static volatile void (*_int1_handler)(void) = 0;

ISR(INT0_vect) { if (_int0_handler) _int0_handler(); }

ISR(INT1_vect) { if (_int1_handler) _int1_handler(); }

// Auto-generated setup() for top-level statements
void setup()
{
  // Test 1: Basic digital I/O
  DDRB |= (1 << 5);
  PORTB |= (1 << 5);
  _native_delay_ms(100);
  PORTB &= ~(1 << 5);
  // Test 2: Digital read
  DDRD &= ~(1 << 2), PORTD |= (1 << 2);
  // Test 3: PWM output
  DDRB |= (1 << 1);
  TCCR1A |= (1 << COM1A1) | (1 << WGM10), TCCR1B |= (1 << CS11), OCR1A = 128;
  // 50% duty cycle
  _native_delay_ms(1000);
  // Test 7: Interrupt
  DDRD &= ~(1 << 2), PORTD &= ~(1 << 2);
  ({ _init_timer0(); if (2 == 2) { _int0_handler = () => {
  console.log('Button pressed!');
}; EICRA = (EICRA & ~0x03) | (static_cast<int>(InterruptMode::_FALLING) << 0); EIMSK |= (1 << INT0); } else if (2 == 3) { _int1_handler = () => {
  console.log('Button pressed!');
}; EICRA = (EICRA & ~0x0C) | (static_cast<int>(InterruptMode::_FALLING) << 2); EIMSK |= (1 << INT1); } });
  // Main loop
  while (true)
  {
    // Use micros for precise timing
    if (buttonState == 1)
    {
      PORTB ^= (1 << 5);
    }
    _native_delay_ms(50);
  }
}

void loop()
{
}

