#include <Arduino.h>
#include <math.h>

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
int __tc_fn8();
int __tc_fn9();
int __tc_fn10();
float __tc_fn11();
int __tc_fn12();
int __tc_fn13();
int __tc_fn14();
int __tc_fn7__add(int a, int b);
int __tc_fn8__clamp(int value, int min = 0, int max = 1023);

// Auto-generated setup() for top-level statements
void setup()
{
  Serial.begin(115200);
  Serial.println("[TC:SUITE_START]");
  Serial.println("[TC:DESCRIBE:Basics]");
  Serial.println("[TC:IT:basic math]");
  Serial.print("[TC:EXPECT:toBe:3:");
  Serial.print(__tc_fn1());
  Serial.println("]");
  Serial.print("[TC:EXPECT:toBe:1:");
  Serial.print(__tc_fn2());
  Serial.println("]");
  Serial.print("[TC:EXPECT:toBe:6:");
  Serial.print(__tc_fn3());
  Serial.println("]");
  Serial.println("[TC:IT:Variable assignment]");
  Serial.print("[TC:EXPECT:toBe:1:");
  Serial.print(__tc_fn4());
  Serial.println("]");
  Serial.print("[TC:EXPECT:toBe:2:");
  Serial.print(__tc_fn5());
  Serial.println("]");
  Serial.print("[TC:EXPECT:toBe:3:");
  Serial.print(__tc_fn6());
  Serial.println("]");
  Serial.println("[TC:IT:Functions]");
  Serial.print("[TC:EXPECT:toBe:3:");
  Serial.print(__tc_fn7());
  Serial.println("]");
  Serial.print("[TC:EXPECT:toBe:1023:");
  Serial.print(__tc_fn8());
  Serial.println("]");
  Serial.println("[TC:IT:Arrays]");
  Serial.print("[TC:EXPECT:toBe:0x10:");
  Serial.print(__tc_fn9());
  Serial.println("]");
  Serial.print("[TC:EXPECT:toBe:-2:");
  Serial.print(__tc_fn10());
  Serial.println("]");
  Serial.print("[TC:EXPECT:toBe:0.5:");
  Serial.print(__tc_fn11());
  Serial.println("]");
  Serial.print("[TC:EXPECT:toBe:150:");
  Serial.print(__tc_fn12());
  Serial.println("]");
  Serial.print("[TC:EXPECT:toBe:150:");
  Serial.print(__tc_fn13());
  Serial.println("]");
  Serial.print("[TC:EXPECT:toBe:500:");
  Serial.print(__tc_fn14());
  Serial.println("]");
  Serial.println("[TC:SUITE_END]");
  while (true)
  {
    delay(1000);
  }
}

int __tc_fn1()
{
  const int a = 1;
  int b = 2;
  return a + b;
}

int __tc_fn2()
{
  const int a = 1;
  int b = 2;
  return b - a;
}

int __tc_fn3()
{
  int b = 2;
  int c = 3;
  return b * c;
}

int __tc_fn4()
{
  const int a = 1;
  return a;
}

int __tc_fn5()
{
  int b = 2;
  return b;
}

int __tc_fn6()
{
  int c = 3;
  return c;
}

int __tc_fn7()
{
  return __tc_fn7__add(1, 2);
}

int __tc_fn8()
{
  return __tc_fn8__clamp(2000, 0);
}

int __tc_fn9()
{
  uint8_t uint8array[] = { 170, 16, 32 };
  return uint8array[1];
}

int __tc_fn10()
{
  int16_t int16array[] = { 4, -2, 7 };
  return int16array[1];
}

float __tc_fn11()
{
  float float32array[] = { 1.0f, 0.5f, 0.25f };
  return float32array[1];
}

int __tc_fn12()
{
  struct _config_t { int low; int high; int timeout; } config = { 150, 700, TYPECODE_UNDEFINED };
  return config.low;
}

int __tc_fn13()
{
  struct _config_t { int low; int high; int timeout; } config = { 150, 700, TYPECODE_UNDEFINED };
  const int low = config.low;
  return low;
}

int __tc_fn14()
{
  struct _config_t { int low; int high; int timeout; } config = { 150, 700, TYPECODE_UNDEFINED };
  const int timeout = typecode_nullish(config.timeout, 500);
  return timeout;
}

int __tc_fn7__add(int a, int b)
{
  return a + b;
}

int __tc_fn8__clamp(int value, int min, int max)
{
  return max(min, min(max, value));
}

void loop()
{
}
