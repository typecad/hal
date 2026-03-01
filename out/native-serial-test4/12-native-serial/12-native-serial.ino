
// ---- entry sketch ----
#include <avr/io.h>

#define console_log(...) console_log(__VA_ARGS__)
// Note: Add Serial.begin(9600); in setup() for console output

// Polyfill: console.log for Arduino
inline void console_log(const char* msg) { Serial.println(msg); }
inline void console_log(int val) { Serial.println(val); }
inline void console_log(unsigned int val) { Serial.println(val); }
inline void console_log(long val) { Serial.println(val); }
inline void console_log(unsigned long val) { Serial.println(val); }
inline void console_log(float val) { Serial.println(val); }
inline void console_log(double val) { Serial.println(val); }
inline void console_log(bool val) { Serial.println(val ? "true" : "false"); }

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


int counter = 0;

// Auto-generated setup() for top-level statements
void setup()
{
  // Initialize Serial at 9600 baud
  _uart_init(9600);
  // Print startup message
  _uart_println("Native UART Demo");
  _uart_println("================");
  // Configure A0 as analog input
  DDRC &= ~0x1, PORTC &= ~0x1;
  while (true)
  {
    // Read analog value
    const int sensorValue = ({ ADMUX = (1 << REFS0) | 0; ADCSRA |= (1 << ADSC); while (ADCSRA & (1 << ADSC)); ADC; });
    // Print counter and sensor value
    _uart_print("Count: ");
    _uart_println(counter);
    _uart_print("ADC: ");
    _uart_println(sensorValue);
    // Also demonstrate console.log (maps to Serial.println)
    _uart_println("Loop iteration complete")
    counter++;
    _native_delay_ms(1000);
  }
}

void loop()
{
}

