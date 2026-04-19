#include <Arduino.h>

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
int __tc_fn11();
int __tc_fn12();
float __tc_fn13();
int __tc_fn14();
int __tc_fn15();
int __tc_fn16();
int __tc_fn17();
int __tc_fn18();

// Auto-generated setup() for top-level statements
void setup()
{
  Serial.begin(115200);
  Serial.println("[TC:SUITE_START]");
  Serial.println("[TC:DESCRIBE:Arithmetic operators]");
  Serial.println("[TC:IT:division and modulo]");
  Serial.print("[TC:EXPECT:toBe:1:");
  Serial.print(__tc_fn1());
  Serial.println("]");
  Serial.print("[TC:EXPECT:toBe:1:");
  Serial.print(__tc_fn2());
  Serial.println("]");
  Serial.println("[TC:IT:unary negation]");
  Serial.print("[TC:EXPECT:toBe:-1:");
  Serial.print(__tc_fn3());
  Serial.println("]");
  Serial.print("[TC:EXPECT:toBe:42:");
  Serial.print(__tc_fn4());
  Serial.println("]");
  Serial.println("[TC:IT:order of operations]");
  Serial.print("[TC:EXPECT:toBe:14:");
  Serial.print(__tc_fn5());
  Serial.println("]");
  Serial.println("[TC:IT:parenthesized expressions (Bug 7)]");
  Serial.print("[TC:EXPECT:toBe:20:");
  Serial.print(__tc_fn6());
  Serial.println("]");
  Serial.print("[TC:EXPECT:toBe:14:");
  Serial.print(__tc_fn7());
  Serial.println("]");
  Serial.print("[TC:EXPECT:toBe:21:");
  Serial.print(__tc_fn8());
  Serial.println("]");
  Serial.println("[TC:DESCRIBE:Number literals]");
  Serial.println("[TC:IT:hex literal]");
  Serial.print("[TC:EXPECT:toBe:255:");
  Serial.print(__tc_fn9());
  Serial.println("]");
  Serial.println("[TC:IT:binary literal]");
  Serial.print("[TC:EXPECT:toBe:10:");
  Serial.print(__tc_fn10());
  Serial.println("]");
  Serial.println("[TC:IT:octal literal]");
  Serial.print("[TC:EXPECT:toBe:63:");
  Serial.print(__tc_fn11());
  Serial.println("]");
  Serial.println("[TC:IT:negative literal]");
  Serial.print("[TC:EXPECT:toBe:-42:");
  Serial.print(__tc_fn12());
  Serial.println("]");
  Serial.println("[TC:IT:floating point literal]");
  Serial.print("[TC:EXPECT:toBeCloseTo:3.14,1:");
  Serial.print(__tc_fn13());
  Serial.println("]");
  Serial.println("[TC:DESCRIBE:Compound assignment]");
  Serial.println("[TC:IT:+=, -=, *=, /=]");
  Serial.print("[TC:EXPECT:toBe:10:");
  Serial.print(__tc_fn14());
  Serial.println("]");
  Serial.print("[TC:EXPECT:toBe:15:");
  Serial.print(__tc_fn15());
  Serial.println("]");
  Serial.print("[TC:EXPECT:toBe:12:");
  Serial.print(__tc_fn16());
  Serial.println("]");
  Serial.print("[TC:EXPECT:toBe:24:");
  Serial.print(__tc_fn17());
  Serial.println("]");
  Serial.print("[TC:EXPECT:toBe:6:");
  Serial.print(__tc_fn18());
  Serial.println("]");
  Serial.println("[TC:SUITE_END]");
  while (true)
  {
    delay(1000);
  }
}

int __tc_fn1()
{
  return 10 % 3;
}

int __tc_fn2()
{
  return 7 % 2;
}

int __tc_fn3()
{
  const int a = 1;
  return -a;
}

int __tc_fn4()
{
  const int negative = -42;
  return -negative;
}

int __tc_fn5()
{
  return 2 + 3 * 4;
}

int __tc_fn6()
{
  return (2 + 3) * 4;
}

int __tc_fn7()
{
  return 2 * (3 + 4);
}

int __tc_fn8()
{
  return (1 + 2) * (3 + 4);
}

int __tc_fn9()
{
  const int hex = 255;
  return hex;
}

int __tc_fn10()
{
  const int binary = 10;
  return binary;
}

int __tc_fn11()
{
  const int octal = 63;
  return octal;
}

int __tc_fn12()
{
  const int negative = -42;
  return negative;
}

float __tc_fn13()
{
  const float floating = 3.14f;
  return floating;
}

int __tc_fn14()
{
  int mut = 10;
  return mut;
}

int __tc_fn15()
{
  int mut = 10;
  mut += 5;
  return mut;
}

int __tc_fn16()
{
  int mut = 10;
  mut += 5;
  mut -= 3;
  return mut;
}

int __tc_fn17()
{
  int mut = 10;
  mut += 5;
  mut -= 3;
  mut *= 2;
  return mut;
}

int __tc_fn18()
{
  int mut = 10;
  mut += 5;
  mut -= 3;
  mut *= 2;
  mut /= 4;
  return mut;
}

void loop()
{
}
