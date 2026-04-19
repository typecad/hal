#include <Arduino.h>
#include "transpiler-support.h"

template <typename T>
inline bool typecode_exists(T* value) {
  return value != nullptr;
}

template <typename T>
inline bool typecode_exists(const T&) {
  return true;
}

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
int __tc_fn7();

// Auto-generated setup() for top-level statements
void setup()
{
  Serial.begin(115200);
  Serial.println("[TC:SUITE_START]");
  Serial.println("[TC:DESCRIBE:Modules and imports]");
  Serial.println("[TC:IT:local module function import]");
  Serial.print("[TC:EXPECT:toBe:90:");
  Serial.print(__tc_fn1());
  Serial.println("]");
  Serial.print("[TC:EXPECT:toBe:10:");
  Serial.print(__tc_fn2());
  Serial.println("]");
  Serial.println("[TC:IT:local module class import]");
  Serial.print("[TC:EXPECT:toBe:10:");
  Serial.print(__tc_fn3());
  Serial.println("]");
  Serial.println("[TC:DESCRIBE:Imported types and function expressions]");
  Serial.println("[TC:IT:module type alias through function signature]");
  Serial.print("[TC:EXPECT:toBe:55:");
  Serial.print(__tc_fn4());
  Serial.println("]");
  Serial.println("[TC:IT:function expression]");
  Serial.print("[TC:EXPECT:toBe:42:");
  Serial.print(__tc_fn5());
  Serial.println("]");
  Serial.println("[TC:DESCRIBE:Optional chaining]");
  Serial.println("[TC:IT:property access with fallback]");
  Serial.print("[TC:EXPECT:toBe:21:");
  Serial.print(__tc_fn6());
  Serial.println("]");
  Serial.print("[TC:EXPECT:toBe:250:");
  Serial.print(__tc_fn7());
  Serial.println("]");
  Serial.println("[TC:SUITE_END]");
  while (true)
  {
    delay(1000);
  }
}

int __tc_fn1()
{
  return clampToWindow(120, { 10, 90 });
}

int __tc_fn2()
{
  return clampToWindow(-5, { 10, 90 });
}

int __tc_fn3()
{
  const RollingCounter* counter = new RollingCounter(5);
  counter->add(2);
  counter->add(3);
  return counter->value;
}

int __tc_fn4()
{
  return clampToWindow(55, { 10, 90 });
}

int __tc_fn5()
{
  auto bump = [=](int value) -> int {
  return value + 1;
};
  return bump(41);
}

int __tc_fn6()
{
  struct _wrapper_sensor_t { int reading; };
  struct _wrapper_t { _wrapper_sensor_t sensor; } wrapper = { { 21 } };
  return typecode_nullish((typecode_exists(wrapper.sensor) ? wrapper.sensor.reading : 0), 0);
}

int __tc_fn7()
{
  struct _config_t { int timeout; int fallback; } config = { TYPECODE_UNDEFINED, 250 };
  return typecode_nullish(config.timeout, config.fallback);
}

void loop()
{
}
