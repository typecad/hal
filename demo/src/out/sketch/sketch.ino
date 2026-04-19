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

const int a = 1;
int b = 2;
int c = 3;
uint8_t uint8array[] = { 170, 16, 32 };
int16_t int16array[] = { 4, -2, 7 };
float float32array[] = { 1.0f, 0.5f, 0.25f };
struct _config_t { int low; int high; int timeout; } config = { 150, 700, TYPECODE_UNDEFINED };
const int low = config.low;
const int high = config.high;
const int hex = 255;
const int binary = 10;
const int octal = 63;
const int negative = -42;
const float floating = 3.14f;
int mut = 10;
int n1 = 1;
int n2 = 2;
int n3 = 3;
int n5 = 5;
int scores[] = { 10, 20, 30, 40 };


int add(int a, int b);
int clamp(int value, int min = 0, int max = 1023);
int square(int x);
int forOfSum();
int __tc_fn1();

// Auto-generated setup() for top-level statements
void setup()
{
  Serial.begin(115200);
  Serial.println("[TC:SUITE_START]");
  const int timeout = typecode_nullish(config.timeout, 500);
  Serial.println("[TC:DESCRIBE:Basics]");
  Serial.println("[TC:IT:basic math]");
  Serial.print("[TC:EXPECT:toBe:3:");
  Serial.print(a + b);
  Serial.println("]");
  Serial.print("[TC:EXPECT:toBe:1:");
  Serial.print(b - a);
  Serial.println("]");
  Serial.print("[TC:EXPECT:toBe:6:");
  Serial.print(b * c);
  Serial.println("]");
  Serial.println("[TC:IT:Variable assignment]");
  Serial.print("[TC:EXPECT:toBe:1:");
  Serial.print(a);
  Serial.println("]");
  Serial.print("[TC:EXPECT:toBe:2:");
  Serial.print(b);
  Serial.println("]");
  Serial.print("[TC:EXPECT:toBe:3:");
  Serial.print(c);
  Serial.println("]");
  Serial.println("[TC:IT:Functions]");
  Serial.print("[TC:EXPECT:toBe:3:");
  Serial.print(add(1, 2));
  Serial.println("]");
  Serial.print("[TC:EXPECT:toBe:1023:");
  Serial.print(clamp(2000, 0));
  Serial.println("]");
  Serial.println("[TC:IT:Arrays]");
  Serial.print("[TC:EXPECT:toBe:0x10:");
  Serial.print(uint8array[1]);
  Serial.println("]");
  Serial.print("[TC:EXPECT:toBe:-2:");
  Serial.print(int16array[1]);
  Serial.println("]");
  Serial.print("[TC:EXPECT:toBe:0.5:");
  Serial.print(float32array[1]);
  Serial.println("]");
  Serial.print("[TC:EXPECT:toBe:150:");
  Serial.print(config.low);
  Serial.println("]");
  Serial.print("[TC:EXPECT:toBe:150:");
  Serial.print(low);
  Serial.println("]");
  Serial.print("[TC:EXPECT:toBe:500:");
  Serial.print(timeout);
  Serial.println("]");
  Serial.println("[TC:DESCRIBE:Arithmetic operators]");
  Serial.println("[TC:IT:division and modulo]");
  Serial.print("[TC:EXPECT:toBe:1:");
  Serial.print(10 % 3);
  Serial.println("]");
  Serial.print("[TC:EXPECT:toBe:1:");
  Serial.print(7 % 2);
  Serial.println("]");
  Serial.println("[TC:IT:unary negation]");
  Serial.print("[TC:EXPECT:toBe:-1:");
  Serial.print(-a);
  Serial.println("]");
  Serial.print("[TC:EXPECT:toBe:42:");
  Serial.print(-negative);
  Serial.println("]");
  Serial.println("[TC:IT:order of operations]");
  Serial.print("[TC:EXPECT:toBe:14:");
  Serial.print(2 + 3 * 4);
  Serial.println("]");
  Serial.println("[TC:IT:parenthesized expressions (Bug 7)]");
  Serial.print("[TC:EXPECT:toBe:20:");
  Serial.print((2 + 3) * 4);
  Serial.println("]");
  Serial.print("[TC:EXPECT:toBe:14:");
  Serial.print(2 * (3 + 4));
  Serial.println("]");
  Serial.print("[TC:EXPECT:toBe:21:");
  Serial.print((1 + 2) * (3 + 4));
  Serial.println("]");
  Serial.println("[TC:DESCRIBE:Number literals]");
  Serial.println("[TC:IT:hex literal]");
  Serial.print("[TC:EXPECT:toBe:255:");
  Serial.print(hex);
  Serial.println("]");
  Serial.println("[TC:IT:binary literal]");
  Serial.print("[TC:EXPECT:toBe:10:");
  Serial.print(binary);
  Serial.println("]");
  Serial.println("[TC:IT:octal literal]");
  Serial.print("[TC:EXPECT:toBe:63:");
  Serial.print(octal);
  Serial.println("]");
  Serial.println("[TC:IT:negative literal]");
  Serial.print("[TC:EXPECT:toBe:-42:");
  Serial.print(negative);
  Serial.println("]");
  Serial.println("[TC:IT:floating point literal]");
  Serial.print("[TC:EXPECT:toBeCloseTo:3.14,1:");
  Serial.print(floating);
  Serial.println("]");
  Serial.println("[TC:DESCRIBE:Compound assignment]");
  Serial.println("[TC:IT:+=, -=, *=, /=]");
  Serial.print("[TC:EXPECT:toBe:10:");
  Serial.print(mut);
  Serial.println("]");
  Serial.print("[TC:EXPECT:toBe:15:");
  Serial.print(mut += 5);
  Serial.println("]");
  Serial.print("[TC:EXPECT:toBe:12:");
  Serial.print(mut -= 3);
  Serial.println("]");
  Serial.print("[TC:EXPECT:toBe:24:");
  Serial.print(mut *= 2);
  Serial.println("]");
  Serial.print("[TC:EXPECT:toBe:6:");
  Serial.print(mut /= 4);
  Serial.println("]");
  Serial.println("[TC:DESCRIBE:Comparison via ternary]");
  Serial.println("[TC:IT:equality and inequality]");
  Serial.print("[TC:EXPECT:toBe:1:");
  Serial.print((n5 == n5 ? 1 : 0));
  Serial.println("]");
  Serial.print("[TC:EXPECT:toBe:0:");
  Serial.print((n5 == n3 ? 1 : 0));
  Serial.println("]");
  Serial.print("[TC:EXPECT:toBe:1:");
  Serial.print((n5 != n3 ? 1 : 0));
  Serial.println("]");
  Serial.println("[TC:IT:less than / greater than]");
  Serial.print("[TC:EXPECT:toBe:1:");
  Serial.print((n3 < n5 ? 1 : 0));
  Serial.println("]");
  Serial.print("[TC:EXPECT:toBe:1:");
  Serial.print((n5 > n3 ? 1 : 0));
  Serial.println("]");
  Serial.print("[TC:EXPECT:toBe:0:");
  Serial.print((n5 < n3 ? 1 : 0));
  Serial.println("]");
  Serial.println("[TC:IT:less or equal / greater or equal]");
  Serial.print("[TC:EXPECT:toBe:1:");
  Serial.print((n5 <= n5 ? 1 : 0));
  Serial.println("]");
  Serial.print("[TC:EXPECT:toBe:1:");
  Serial.print((n3 <= n5 ? 1 : 0));
  Serial.println("]");
  Serial.print("[TC:EXPECT:toBe:1:");
  Serial.print((n5 >= n5 ? 1 : 0));
  Serial.println("]");
  Serial.print("[TC:EXPECT:toBe:1:");
  Serial.print((n5 >= n3 ? 1 : 0));
  Serial.println("]");
  Serial.println("[TC:DESCRIBE:Logical operators via numeric patterns]");
  Serial.println("[TC:IT:logical AND]");
  Serial.print("[TC:EXPECT:toBe:1:");
  Serial.print((n1 == n1 && n2 == n2 ? 1 : 0));
  Serial.println("]");
  Serial.print("[TC:EXPECT:toBe:0:");
  Serial.print((n1 == n1 && n2 == n3 ? 1 : 0));
  Serial.println("]");
  Serial.println("[TC:IT:logical OR]");
  Serial.print("[TC:EXPECT:toBe:1:");
  Serial.print((n1 == n1 || n2 == n3 ? 1 : 0));
  Serial.println("]");
  Serial.print("[TC:EXPECT:toBe:0:");
  Serial.print((n1 == n3 || n2 == n3 ? 1 : 0));
  Serial.println("]");
  Serial.println("[TC:IT:logical NOT]");
  Serial.print("[TC:EXPECT:toBe:1:");
  Serial.print((n1 != n3 ? 1 : 0));
  Serial.println("]");
  Serial.print("[TC:EXPECT:toBe:0:");
  Serial.print((n1 != n1 ? 1 : 0));
  Serial.println("]");
  Serial.println("[TC:DESCRIBE:Bitwise operators]");
  Serial.println("[TC:IT:AND, OR, XOR]");
  Serial.print("[TC:EXPECT:toBe:0x0F:");
  Serial.print(255 & 15);
  Serial.println("]");
  Serial.print("[TC:EXPECT:toBe:0xFF:");
  Serial.print(240 | 15);
  Serial.println("]");
  Serial.print("[TC:EXPECT:toBe:0xF0:");
  Serial.print(255 ^ 15);
  Serial.println("]");
  Serial.println("[TC:IT:shifts and NOT]");
  Serial.print("[TC:EXPECT:toBe:16:");
  Serial.print(1 << 4);
  Serial.println("]");
  Serial.print("[TC:EXPECT:toBe:16:");
  Serial.print(256 >> 4);
  Serial.println("]");
  Serial.print("[TC:EXPECT:toBe:-1:");
  Serial.print(~0);
  Serial.println("]");
  Serial.println("[TC:DESCRIBE:Ternary expressions]");
  Serial.println("[TC:IT:simple ternary]");
  Serial.print("[TC:EXPECT:toBe:1:");
  Serial.print((n1 == n1 ? 1 : 0));
  Serial.println("]");
  Serial.print("[TC:EXPECT:toBe:0:");
  Serial.print((n1 == n3 ? 1 : 0));
  Serial.println("]");
  Serial.println("[TC:IT:nested ternary]");
  Serial.print("[TC:EXPECT:toBe:2:");
  Serial.print((n5 > 10 ? 1 : (n5 > n3 ? 2 : 3)));
  Serial.println("]");
  Serial.println("[TC:DESCRIBE:Arrow function]");
  Serial.println("[TC:IT:arrow function call]");
  Serial.print("[TC:EXPECT:toBe:16:");
  Serial.print(square(4));
  Serial.println("]");
  Serial.print("[TC:EXPECT:toBe:49:");
  Serial.print(square(7));
  Serial.println("]");
  Serial.println("[TC:DESCRIBE:For-of loop]");
  Serial.println("[TC:IT:for-of accumulation]");
  Serial.print("[TC:EXPECT:toBe:100:");
  Serial.print(forOfSum());
  Serial.println("]");
  Serial.println("[TC:DESCRIBE:Variables and Scoping]");
  Serial.println("[TC:IT:block scoping (shadowing)]");
  Serial.print("[TC:EXPECT:toBe:1:");
  Serial.print(__tc_fn1());
  Serial.println("]");
  Serial.println("[TC:SUITE_END]");
  while (true)
  {
    delay(1000);
  }
}

int add(int a, int b)
{
  return a + b;
}

int clamp(int value, int min, int max)
{
  return max(min, min(max, value));
}

int square(int x)
{
  return x * x;
}

int forOfSum()
{
  int total = 0;
  for (const int value : scores)
  {
    total += value;
  }
  return total;
}

int __tc_fn1()
{
  int x = 1;
  {
    int x = 2;
    // Should not overwrite outer x in C++
  }
  return x;
}

void loop()
{
}
