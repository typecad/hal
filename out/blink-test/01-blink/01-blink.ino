#include <avr/io.h>
#include <Pins.h>
#include <Timing.h>

#ifndef F_CPU
#define F_CPU 16000000UL  // 16 MHz clock frequency
#endif
#include <util/delay.h>
#include <avr/interrupt.h>

static inline void _native_delay_ms(unsigned long ms) { while (ms--) _delay_ms(1); }
static inline void _native_delay_us(unsigned int us) { while (us--) _delay_us(1); }

// Optimized map: uses bit shifts when ranges are power-of-2
static inline long _native_map(long x, long in_min, long in_max, long out_min, long out_max) {
  // Check for power-of-2 ranges (common case: 0-1023 -> 0-255)
  if (in_min == 0 && out_min == 0) {
    long in_range = in_max - in_min + 1;
    long out_range = out_max - out_min + 1;
    // 1024/256 = 4, so >> 2
    if (in_range == 1024 && out_range == 256) return x >> 2;
    // 1024/128 = 8, so >> 3
    if (in_range == 1024 && out_range == 128) return x >> 3;
    // 256/1024 = 1/4, so << 2 (with bounds check)
    if (in_range == 256 && out_range == 1024) { long r = x << 2; return r > 1023 ? 1023 : r; }
  }
  // Generic case
  return (x - in_min) * (out_max - out_min) / (in_max - in_min) + out_min;
}

static inline long _native_constrain(long x, long a, long b) {
  return (x < a) ? a : ((x > b) ? b : x);
}


// Auto-generated setup() for top-level statements
void setup()
{
  DDRB |= 0x20;
  while (true)
  {
    PORTB ^= (1 << 5);
    _native_delay_ms(1000);
  }
}

void loop()
{
}
