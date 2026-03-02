#include <avr/io.h>
#include <Pins.h>
#include <Timing.h>

#ifndef F_CPU
#define F_CPU 16000000UL  // 16 MHz clock frequency
#endif
#include <util/delay.h>
#include <avr/interrupt.h>

// UART initialization (native AVR USART0)
static inline void _uart_init(unsigned long baud) {
  unsigned int ubrr = (F_CPU / 16 / baud - 1);
  UBRR0H = (unsigned char)(ubrr >> 8);
  UBRR0L = (unsigned char)ubrr;
  UCSR0B = (1 << RXEN0) | (1 << TXEN0);
  UCSR0C = (1 << UCSZ01) | (1 << UCSZ00);  // 8N1
}

// Check if data available to read
static inline int _uart_available() {
  return (UCSR0A & (1 << RXC0)) ? 1 : 0;
}

// Read a single byte (blocking)
static inline int _uart_read() {
  while (!(UCSR0A & (1 << RXC0)));
  return UDR0;
}

// Write a single byte (blocking)
static inline void _uart_write(unsigned char data) {
  while (!(UCSR0A & (1 << UDRE0)));
  UDR0 = data;
}

// Print a null-terminated string
static inline void _uart_print(const char* str) {
  while (*str) _uart_write(*str++);
}

// Print string with newline
static inline void _uart_println(const char* str) {
  _uart_print(str);
  _uart_write('\r');
  _uart_write('\n');
}

// Print a long integer
static inline void _uart_print_long(long num) {
  char buf[12];
  ltoa(num, buf, 10);
  _uart_print(buf);
}

// Print a long integer with newline
static inline void _uart_println_long(long num) {
  _uart_print_long(num);
  _uart_write('\r');
  _uart_write('\n');
}

// Print a float (2 decimal places)
static inline void _uart_print_float(float num) {
  if (num < 0) { _uart_write('-'); num = -num; }
  long integer = (long)num;
  long decimal = (long)((num - integer) * 100);
  _uart_print_long(integer);
  _uart_write('.');
  if (decimal < 10) _uart_write('0');
  _uart_print_long(decimal);
}

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
  _uart_init(9600);
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
