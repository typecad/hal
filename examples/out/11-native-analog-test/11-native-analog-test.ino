
// ---- entry sketch ----
#include <avr/io.h>

#ifndef F_CPU
#define F_CPU 16000000UL  // 16 MHz clock frequency
#endif
#include <util/delay.h>
#include <avr/interrupt.h>

static inline void _native_delay_ms(unsigned long ms) { while (ms--) _delay_ms(1); }
static inline void _native_delay_us(unsigned int us) { while (us--) _delay_us(1); }

static inline long _native_map(long x, long in_min, long in_max, long out_min, long out_max) {
  return (x - in_min) * (out_max - out_min) / (in_max - in_min) + out_min;
}

static inline long _native_constrain(long x, long a, long b) {
  return (x < a) ? a : ((x > b) ? b : x);
}


// Auto-generated setup() for top-level statements
void setup()
{
  DDRB |= (1 << 1);
  while (true)
  {
    const int sensorValue = ({ ADMUX = (1 << REFS0) | 0; ADCSRA |= (1 << ADSC); while (ADCSRA & (1 << ADSC)); ADC; });
    // Should NOT include ADC init check
    const int pwmValue = map(sensorValue, 0, 1023, 0, 255);
    TCCR1A |= (1 << COM1A1) | (1 << WGM10), TCCR1B |= (1 << CS11), OCR1A = pwmValue;
    _native_delay_ms(10);
  }
}

void loop()
{
}

