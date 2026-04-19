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
int __tc_fn15();
int __tc_fn16();
int __tc_fn17();
int __tc_fn18();
int __tc_fn19();
int __tc_fn20();
int __tc_fn21();
int __tc_fn22();
int __tc_fn23();
int __tc_fn24();
int __tc_fn25();
int __tc_fn26();
float __tc_fn27();
int __tc_fn28();
int __tc_fn29();
int __tc_fn30();
int __tc_fn31();
int __tc_fn32();
int __tc_fn33();
int __tc_fn34();
int __tc_fn35();
int __tc_fn36();
int __tc_fn37();
int __tc_fn38();
int __tc_fn39();
int __tc_fn40();
int __tc_fn41();
int __tc_fn42();
int __tc_fn43();
int __tc_fn44();
int __tc_fn45();
int __tc_fn46();
int __tc_fn47();
int __tc_fn48();
int __tc_fn49();
int __tc_fn50();
int __tc_fn51();
int __tc_fn52();
int __tc_fn53();
int __tc_fn54();
int __tc_fn55();
int __tc_fn56();
int __tc_fn57();
int __tc_fn58();
int __tc_fn59();
int __tc_fn60();
int __tc_fn61();
int __tc_fn62();
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
  Serial.println("[TC:DESCRIBE:Arithmetic operators]");
  Serial.println("[TC:IT:division and modulo]");
  Serial.print("[TC:EXPECT:toBe:1:");
  Serial.print(__tc_fn15());
  Serial.println("]");
  Serial.print("[TC:EXPECT:toBe:1:");
  Serial.print(__tc_fn16());
  Serial.println("]");
  Serial.println("[TC:IT:unary negation]");
  Serial.print("[TC:EXPECT:toBe:-1:");
  Serial.print(__tc_fn17());
  Serial.println("]");
  Serial.print("[TC:EXPECT:toBe:42:");
  Serial.print(__tc_fn18());
  Serial.println("]");
  Serial.println("[TC:IT:order of operations]");
  Serial.print("[TC:EXPECT:toBe:14:");
  Serial.print(__tc_fn19());
  Serial.println("]");
  Serial.println("[TC:IT:parenthesized expressions (Bug 7)]");
  Serial.print("[TC:EXPECT:toBe:20:");
  Serial.print(__tc_fn20());
  Serial.println("]");
  Serial.print("[TC:EXPECT:toBe:14:");
  Serial.print(__tc_fn21());
  Serial.println("]");
  Serial.print("[TC:EXPECT:toBe:21:");
  Serial.print(__tc_fn22());
  Serial.println("]");
  Serial.println("[TC:DESCRIBE:Number literals]");
  Serial.println("[TC:IT:hex literal]");
  Serial.print("[TC:EXPECT:toBe:255:");
  Serial.print(__tc_fn23());
  Serial.println("]");
  Serial.println("[TC:IT:binary literal]");
  Serial.print("[TC:EXPECT:toBe:10:");
  Serial.print(__tc_fn24());
  Serial.println("]");
  Serial.println("[TC:IT:octal literal]");
  Serial.print("[TC:EXPECT:toBe:63:");
  Serial.print(__tc_fn25());
  Serial.println("]");
  Serial.println("[TC:IT:negative literal]");
  Serial.print("[TC:EXPECT:toBe:-42:");
  Serial.print(__tc_fn26());
  Serial.println("]");
  Serial.println("[TC:IT:floating point literal]");
  Serial.print("[TC:EXPECT:toBeCloseTo:3.14,1:");
  Serial.print(__tc_fn27());
  Serial.println("]");
  Serial.println("[TC:DESCRIBE:Compound assignment]");
  Serial.println("[TC:IT:+=, -=, *=, /=]");
  Serial.print("[TC:EXPECT:toBe:10:");
  Serial.print(__tc_fn28());
  Serial.println("]");
  Serial.print("[TC:EXPECT:toBe:15:");
  Serial.print(__tc_fn29());
  Serial.println("]");
  Serial.print("[TC:EXPECT:toBe:12:");
  Serial.print(__tc_fn30());
  Serial.println("]");
  Serial.print("[TC:EXPECT:toBe:24:");
  Serial.print(__tc_fn31());
  Serial.println("]");
  Serial.print("[TC:EXPECT:toBe:6:");
  Serial.print(__tc_fn32());
  Serial.println("]");
  Serial.println("[TC:DESCRIBE:Comparison via ternary]");
  Serial.println("[TC:IT:equality and inequality]");
  Serial.print("[TC:EXPECT:toBe:1:");
  Serial.print(__tc_fn33());
  Serial.println("]");
  Serial.print("[TC:EXPECT:toBe:0:");
  Serial.print(__tc_fn34());
  Serial.println("]");
  Serial.print("[TC:EXPECT:toBe:1:");
  Serial.print(__tc_fn35());
  Serial.println("]");
  Serial.println("[TC:IT:less than / greater than]");
  Serial.print("[TC:EXPECT:toBe:1:");
  Serial.print(__tc_fn36());
  Serial.println("]");
  Serial.print("[TC:EXPECT:toBe:1:");
  Serial.print(__tc_fn37());
  Serial.println("]");
  Serial.print("[TC:EXPECT:toBe:0:");
  Serial.print(__tc_fn38());
  Serial.println("]");
  Serial.println("[TC:IT:less or equal / greater or equal]");
  Serial.print("[TC:EXPECT:toBe:1:");
  Serial.print(__tc_fn39());
  Serial.println("]");
  Serial.print("[TC:EXPECT:toBe:1:");
  Serial.print(__tc_fn40());
  Serial.println("]");
  Serial.print("[TC:EXPECT:toBe:1:");
  Serial.print(__tc_fn41());
  Serial.println("]");
  Serial.print("[TC:EXPECT:toBe:1:");
  Serial.print(__tc_fn42());
  Serial.println("]");
  Serial.println("[TC:DESCRIBE:Logical operators via numeric patterns]");
  Serial.println("[TC:IT:logical AND]");
  Serial.print("[TC:EXPECT:toBe:1:");
  Serial.print(__tc_fn43());
  Serial.println("]");
  Serial.print("[TC:EXPECT:toBe:0:");
  Serial.print(__tc_fn44());
  Serial.println("]");
  Serial.println("[TC:IT:logical OR]");
  Serial.print("[TC:EXPECT:toBe:1:");
  Serial.print(__tc_fn45());
  Serial.println("]");
  Serial.print("[TC:EXPECT:toBe:0:");
  Serial.print(__tc_fn46());
  Serial.println("]");
  Serial.println("[TC:IT:logical NOT]");
  Serial.print("[TC:EXPECT:toBe:1:");
  Serial.print(__tc_fn47());
  Serial.println("]");
  Serial.print("[TC:EXPECT:toBe:0:");
  Serial.print(__tc_fn48());
  Serial.println("]");
  Serial.println("[TC:DESCRIBE:Bitwise operators]");
  Serial.println("[TC:IT:AND, OR, XOR]");
  Serial.print("[TC:EXPECT:toBe:0x0F:");
  Serial.print(__tc_fn49());
  Serial.println("]");
  Serial.print("[TC:EXPECT:toBe:0xFF:");
  Serial.print(__tc_fn50());
  Serial.println("]");
  Serial.print("[TC:EXPECT:toBe:0xF0:");
  Serial.print(__tc_fn51());
  Serial.println("]");
  Serial.println("[TC:IT:shifts and NOT]");
  Serial.print("[TC:EXPECT:toBe:16:");
  Serial.print(__tc_fn52());
  Serial.println("]");
  Serial.print("[TC:EXPECT:toBe:16:");
  Serial.print(__tc_fn53());
  Serial.println("]");
  Serial.print("[TC:EXPECT:toBe:-1:");
  Serial.print(__tc_fn54());
  Serial.println("]");
  Serial.println("[TC:DESCRIBE:Ternary expressions]");
  Serial.println("[TC:IT:simple ternary]");
  Serial.print("[TC:EXPECT:toBe:1:");
  Serial.print(__tc_fn55());
  Serial.println("]");
  Serial.print("[TC:EXPECT:toBe:0:");
  Serial.print(__tc_fn56());
  Serial.println("]");
  Serial.println("[TC:IT:nested ternary]");
  Serial.print("[TC:EXPECT:toBe:2:");
  Serial.print(__tc_fn57());
  Serial.println("]");
  Serial.println("[TC:DESCRIBE:Arrow function]");
  Serial.println("[TC:IT:arrow function call]");
  Serial.print("[TC:EXPECT:toBe:16:");
  Serial.print(__tc_fn58());
  Serial.println("]");
  Serial.print("[TC:EXPECT:toBe:49:");
  Serial.print(__tc_fn59());
  Serial.println("]");
  Serial.println("[TC:DESCRIBE:For-of loop]");
  Serial.println("[TC:IT:for-of accumulation]");
  Serial.print("[TC:EXPECT:toBe:100:");
  Serial.print(__tc_fn60());
  Serial.println("]");
  Serial.println("[TC:DESCRIBE:Variables and Scoping]");
  Serial.println("[TC:IT:const and let assignment]");
  Serial.print("[TC:EXPECT:toBe:15:");
  Serial.print(__tc_fn61());
  Serial.println("]");
  Serial.println("[TC:IT:block scoping (shadowing)]");
  Serial.print("[TC:EXPECT:toBe:1:");
  Serial.print(__tc_fn62());
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

int __tc_fn15()
{
  return 10 % 3;
}

int __tc_fn16()
{
  return 7 % 2;
}

int __tc_fn17()
{
  const int a = 1;
  return -a;
}

int __tc_fn18()
{
  const int negative = -42;
  return -negative;
}

int __tc_fn19()
{
  return 2 + 3 * 4;
}

int __tc_fn20()
{
  return (2 + 3) * 4;
}

int __tc_fn21()
{
  return 2 * (3 + 4);
}

int __tc_fn22()
{
  return (1 + 2) * (3 + 4);
}

int __tc_fn23()
{
  const int hex = 255;
  return hex;
}

int __tc_fn24()
{
  const int binary = 10;
  return binary;
}

int __tc_fn25()
{
  const int octal = 63;
  return octal;
}

int __tc_fn26()
{
  const int negative = -42;
  return negative;
}

float __tc_fn27()
{
  const float floating = 3.14f;
  return floating;
}

int __tc_fn28()
{
  int mut = 10;
  return mut;
}

int __tc_fn29()
{
  int mut = 10;
  mut += 5;
  return mut;
}

int __tc_fn30()
{
  int mut = 10;
  mut += 5;
  mut -= 3;
  return mut;
}

int __tc_fn31()
{
  int mut = 10;
  mut += 5;
  mut -= 3;
  mut *= 2;
  return mut;
}

int __tc_fn32()
{
  int mut = 10;
  mut += 5;
  mut -= 3;
  mut *= 2;
  mut /= 4;
  return mut;
}

int __tc_fn33()
{
  int n5 = 5;
  return (n5 == n5 ? 1 : 0);
}

int __tc_fn34()
{
  int n3 = 3;
  int n5 = 5;
  return (n5 == n3 ? 1 : 0);
}

int __tc_fn35()
{
  int n3 = 3;
  int n5 = 5;
  return (n5 != n3 ? 1 : 0);
}

int __tc_fn36()
{
  int n3 = 3;
  int n5 = 5;
  return (n3 < n5 ? 1 : 0);
}

int __tc_fn37()
{
  int n3 = 3;
  int n5 = 5;
  return (n5 > n3 ? 1 : 0);
}

int __tc_fn38()
{
  int n3 = 3;
  int n5 = 5;
  return (n5 < n3 ? 1 : 0);
}

int __tc_fn39()
{
  int n5 = 5;
  return (n5 <= n5 ? 1 : 0);
}

int __tc_fn40()
{
  int n3 = 3;
  int n5 = 5;
  return (n3 <= n5 ? 1 : 0);
}

int __tc_fn41()
{
  int n5 = 5;
  return (n5 >= n5 ? 1 : 0);
}

int __tc_fn42()
{
  int n3 = 3;
  int n5 = 5;
  return (n5 >= n3 ? 1 : 0);
}

int __tc_fn43()
{
  int n1 = 1;
  int n2 = 2;
  return (n1 == n1 && n2 == n2 ? 1 : 0);
}

int __tc_fn44()
{
  int n1 = 1;
  int n2 = 2;
  int n3 = 3;
  return (n1 == n1 && n2 == n3 ? 1 : 0);
}

int __tc_fn45()
{
  int n1 = 1;
  int n2 = 2;
  int n3 = 3;
  return (n1 == n1 || n2 == n3 ? 1 : 0);
}

int __tc_fn46()
{
  int n1 = 1;
  int n2 = 2;
  int n3 = 3;
  return (n1 == n3 || n2 == n3 ? 1 : 0);
}

int __tc_fn47()
{
  int n1 = 1;
  int n3 = 3;
  return (n1 != n3 ? 1 : 0);
}

int __tc_fn48()
{
  int n1 = 1;
  return (n1 != n1 ? 1 : 0);
}

int __tc_fn49()
{
  return 255 & 15;
}

int __tc_fn50()
{
  return 240 | 15;
}

int __tc_fn51()
{
  return 255 ^ 15;
}

int __tc_fn52()
{
  return 1 << 4;
}

int __tc_fn53()
{
  return 256 >> 4;
}

int __tc_fn54()
{
  return ~0;
}

int __tc_fn55()
{
  int n1 = 1;
  int n3 = 3;
  return (n1 == n1 ? 1 : 0);
}

int __tc_fn56()
{
  int n1 = 1;
  int n3 = 3;
  return (n1 == n3 ? 1 : 0);
}

int __tc_fn57()
{
  int n3 = 3;
  int n5 = 5;
  return (n5 > 10 ? 1 : (n5 > n3 ? 2 : 3));
}

int __tc_fn58()
{
  auto square = [=](int x) -> int {
  return x * x;
};
  return square(4);
}

int __tc_fn59()
{
  auto square = [=](int x) -> int {
  return x * x;
};
  return square(7);
}

int __tc_fn60()
{
  int scores[] = { 10, 20, 30, 40 };
  int total = 0;
  for (const int value : scores)
  {
    total += value;
  }
  return total;
}

int __tc_fn61()
{
  const int fixed = 10;
  int mutable_ = 5;
  mutable_ += fixed;
  return mutable_;
}

int __tc_fn62()
{
  int x = 1;
  {
    int x = 2;
    // Should not overwrite outer x in C++
  }
  return x;
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
