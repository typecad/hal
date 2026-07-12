#include <Arduino.h>
#include <avr/wdt.h>

// TypeCAD Core Shims
#ifndef CUTTLEFISH_UNDEFINED
#define CUTTLEFISH_UNDEFINED 0
#endif

// Nullish helpers — overload set so value/struct types (which always
// exist) return false from the generic template, while scalars compare
// against CUTTLEFISH_UNDEFINED. The generic catch-all must NOT cast
// (T)CUTTLEFISH_UNDEFINED — that fails to compile for non-scalar T.
template<typename T> inline bool cuttlefish_is_nullish(const T&) { return false; }
inline bool cuttlefish_is_nullish(int v) { return v == CUTTLEFISH_UNDEFINED; }
inline bool cuttlefish_is_nullish(long v) { return v == CUTTLEFISH_UNDEFINED; }
inline bool cuttlefish_is_nullish(double v) { return v == (double)CUTTLEFISH_UNDEFINED; }
inline bool cuttlefish_is_nullish(bool v) { return v == false; }
template<typename T> inline bool cuttlefish_is_nullish(T* v) { return v == nullptr; }
template<typename T> inline bool cuttlefish_exists(const T& v) { return !cuttlefish_is_nullish(v); }
template<typename T, typename U> inline T cuttlefish_nullish(const T& a, const U& b) { return !cuttlefish_is_nullish(a) ? a : (T)b; }

// TypeCAD Native Polyfills

static double __tc_fn1();
static double __tc_fn2();
static double __tc_fn3();
static double __tc_fn4();
static double __tc_fn5();
static double __tc_fn6();
static double __tc_fn7();
static double __tc_fn8();
static double __tc_fn9();
static double __tc_fn10();
static double __tc_fn11();
static double __tc_fn12();
static double __tc_fn13();
static double __tc_fn14();
static double __tc_fn7__add(double a, double b);
static double __tc_fn8__clamp(double value, double min_ = 0, double max_ = 1023);

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

static double __tc_fn1()
{
  const int a = 1;
  int b = 2;
  return a + b;
}

static double __tc_fn2()
{
  const int a = 1;
  int b = 2;
  return b - a;
}

static double __tc_fn3()
{
  int b = 2;
  int c = 3;
  return b * c;
}

static double __tc_fn4()
{
  const int a = 1;
  return a;
}

static double __tc_fn5()
{
  int b = 2;
  return b;
}

static double __tc_fn6()
{
  int c = 3;
  return c;
}

static double __tc_fn7()
{
  return __tc_fn7__add(1, 2);
}

static double __tc_fn8()
{
  return __tc_fn8__clamp(2000, 0);
}

static double __tc_fn9()
{
  uint8_t uint8array[] = { 170, 16, 32 };
  return uint8array[1];
}

static double __tc_fn10()
{
  int16_t int16array[] = { 4, -2, 7 };
  return int16array[1];
}

static double __tc_fn11()
{
  float float32array[] = { 1, 0.5f, 0.25f };
  return float32array[1];
}

static double __tc_fn12()
{
  struct _config_t { int low; int high; int timeout; } config = { 150, 700, CUTTLEFISH_UNDEFINED };
  return config.low;
}

static double __tc_fn13()
{
  struct _config_t { int low; int high; int timeout; } config = { 150, 700, CUTTLEFISH_UNDEFINED };
  const auto low = config.low;
  return low;
}

static double __tc_fn14()
{
  struct _config_t { int low; int high; int timeout; } config = { 150, 700, CUTTLEFISH_UNDEFINED };
  const auto timeout = cuttlefish_nullish(config.timeout, 500);
  return timeout;
}

static double __tc_fn7__add(double a, double b)
{
  return a + b;
}

static double __tc_fn8__clamp(double value, double min_, double max_)
{
  return (min_ > (max_ < value ? max_ : value) ? min_ : (max_ < value ? max_ : value));
}

void loop()
{
}
