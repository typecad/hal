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

// Arduino string method polyfills
const char* __tc_toUpperCase(const char* s) { static char buf[64]; strncpy(buf, s, 63); buf[63] = '\0'; for (char* p = buf; *p; p++) *p = toupper(*p); return buf; }
const char* __tc_toLowerCase(const char* s) { static char buf[64]; strncpy(buf, s, 63); buf[63] = '\0'; for (char* p = buf; *p; p++) *p = tolower(*p); return buf; }
const char* __tc_trim(const char* s) { while (*s == ' ' || *s == '\t' || *s == '\n' || *s == '\r') s++; int len = strlen(s); while (len > 0 && (s[len-1] == ' ' || s[len-1] == '\t' || s[len-1] == '\n' || s[len-1] == '\r')) len--; static char buf[64]; strncpy(buf, s, len); buf[len] = '\0'; return buf; }
const char* __tc_substring2(const char* s, int start, int end) { int slen = strlen(s); if (start < 0) start = 0; if (end > slen) end = slen; if (end < start) end = start; static char buf[64]; int len = end - start; strncpy(buf, s + start, len); buf[len] = '\0'; return buf; }
const char* __tc_substring1(const char* s, int start) { return __tc_substring2(s, start, strlen(s)); }
const char* __tc_slice2(const char* s, int start, int end) { return __tc_substring2(s, start, end); }
const char* __tc_slice1(const char* s, int start) { return __tc_substring2(s, start, strlen(s)); }
const char* __tc_replace(const char* s, const char* old, const char* repl) { static char buf[64]; const char* pos = strstr(s, old); if (!pos) { strncpy(buf, s, 63); buf[63] = '\0'; return buf; } int beforeLen = (int)(pos - s); int oldLen = (int)strlen(old); int replLen = (int)strlen(repl); if (beforeLen + replLen + (int)strlen(pos + oldLen) >= 64) { strncpy(buf, s, 63); buf[63] = '\0'; return buf; } memcpy(buf, s, beforeLen); memcpy(buf + beforeLen, repl, replLen); strcpy(buf + beforeLen + replLen, pos + oldLen); return buf; }
const char* __tc_charAt(const char* s, int idx) { static char buf[2]; buf[0] = s[idx]; buf[1] = '\0'; return buf; }
int __tc_charCodeAt(const char* s, int idx) { return (int)(unsigned char)s[idx]; }

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
