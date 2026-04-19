#include <Arduino.h>

// Sentinel value representing JS undefined for integer types.
// Uses INT_MIN from <limits.h> so it is correct for the target
// platform (16-bit int on AVR, 32-bit int on ARM/ESP32, etc.).
#include <limits.h>
#ifndef TYPECODE_UNDEFINED
#define TYPECODE_UNDEFINED INT_MIN
#endif

template <typename T, typename U>
inline T typecode_nullish(T value, U fallback) {
  return (value == TYPECODE_UNDEFINED) ? fallback : value;
}

template <typename T>
inline T* typecode_nullish(T* value, T* fallback) {
  return value != nullptr ? value : fallback;
}

int __tc_fn1();
int __tc_fn2();
int __tc_fn3();
int __tc_fn4();
int __tc_fn5();
int __tc_fn6();
int __tc_fn1__scale(int value, int factor = 2);
int __tc_fn2__twice(int value);
int __tc_fn2__plusOne(int value);

// Auto-generated setup() for top-level statements
void setup()
{
  Serial.begin(115200);
  Serial.println("[TC:SUITE_START]");
  Serial.println("[TC:DESCRIBE:Function completeness]");
  Serial.println("[TC:IT:default parameter value]");
  Serial.print("[TC:EXPECT:toBe:42:");
  Serial.print(__tc_fn1());
  Serial.println("]");
  Serial.println("[TC:IT:nested helper calls]");
  Serial.print("[TC:EXPECT:toBe:41:");
  Serial.print(__tc_fn2());
  Serial.println("]");
  Serial.println("[TC:IT:function expression assignment]");
  Serial.print("[TC:EXPECT:toBe:42:");
  Serial.print(__tc_fn3());
  Serial.println("]");
  Serial.println("[TC:DESCRIBE:Collection lowering]");
  Serial.println("[TC:IT:typed array indexing]");
  Serial.print("[TC:EXPECT:toBe:300:");
  Serial.print(__tc_fn4());
  Serial.println("]");
  Serial.println("[TC:IT:readonly array iteration]");
  Serial.print("[TC:EXPECT:toBe:12:");
  Serial.print(__tc_fn5());
  Serial.println("]");
  Serial.println("[TC:DESCRIBE:Destructuring defaults]");
  Serial.println("[TC:IT:object default initializer]");
  Serial.print("[TC:EXPECT:toBe:1000:");
  Serial.print(__tc_fn6());
  Serial.println("]");
  Serial.println("[TC:SUITE_END]");
  while (true)
  {
    delay(1000);
  }
}

int __tc_fn1()
{
  return __tc_fn1__scale(21);
}

int __tc_fn2()
{
  return __tc_fn2__plusOne(__tc_fn2__twice(20));
}

int __tc_fn3()
{
  auto adjust = [=](int value) -> int {
  return value - 2;
};
  return adjust(44);
}

int __tc_fn4()
{
  uint16_t readings[] = { 100, 200, 300 };
  return readings[2];
}

int __tc_fn5()
{
  int values[] = { 3, 4, 5 };
  int total = 0;
  for (const int value : values)
  {
    total += value;
  }
  return total;
}

int __tc_fn6()
{
  struct _settings_t { int timeout; int retries; } settings = { TYPECODE_UNDEFINED, 2 };
  const int timeout = typecode_nullish(settings.timeout, 1000);
  return timeout;
}

int __tc_fn1__scale(int value, int factor)
{
  return value * factor;
}

int __tc_fn2__twice(int value)
{
  return value * 2;
}

int __tc_fn2__plusOne(int value)
{
  return value + 1;
}

void loop()
{
}
