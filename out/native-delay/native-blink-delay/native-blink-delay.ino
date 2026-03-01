
// ---- entry sketch ----
#include <avr/io.h>

#ifndef F_CPU
#define F_CPU 16000000UL  // 16 MHz clock frequency
#endif
#include <util/delay.h>
static inline void _native_delay_ms(unsigned long ms) { while (ms--) _delay_ms(1); }
static inline void _native_delay_us(unsigned int us) { while (us--) _delay_us(1); }

// Auto-generated setup() for top-level statements
void setup()
{
  // Configure LED pin as output
  DDRB |= (1 << 5);
  // Blink loop
  while (true)
  {
    PORTB |= (1 << 5);
    _native_delay_ms(500);
    PORTB &= ~(1 << 5);
    _native_delay_ms(500);
  }
}

void loop()
{
}

