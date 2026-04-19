#include <Arduino.h>

int __tc_fn1();
int __tc_fn2();
int __tc_fn3();
int __tc_fn4();
int __tc_fn5();
int __tc_fn6();

// Auto-generated setup() for top-level statements
void setup()
{
  Serial.begin(115200);
  Serial.println("[TC:SUITE_START]");
  Serial.println("[TC:DESCRIBE:Ternary expressions]");
  Serial.println("[TC:IT:simple ternary]");
  Serial.print("[TC:EXPECT:toBe:1:");
  Serial.print(__tc_fn1());
  Serial.println("]");
  Serial.print("[TC:EXPECT:toBe:0:");
  Serial.print(__tc_fn2());
  Serial.println("]");
  Serial.println("[TC:IT:nested ternary]");
  Serial.print("[TC:EXPECT:toBe:2:");
  Serial.print(__tc_fn3());
  Serial.println("]");
  Serial.println("[TC:DESCRIBE:Arrow function]");
  Serial.println("[TC:IT:arrow function call]");
  Serial.print("[TC:EXPECT:toBe:16:");
  Serial.print(__tc_fn4());
  Serial.println("]");
  Serial.print("[TC:EXPECT:toBe:49:");
  Serial.print(__tc_fn5());
  Serial.println("]");
  Serial.println("[TC:DESCRIBE:For-of loop]");
  Serial.println("[TC:IT:for-of accumulation]");
  Serial.print("[TC:EXPECT:toBe:100:");
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
  int n1 = 1;
  int n3 = 3;
  return (n1 == n1 ? 1 : 0);
}

int __tc_fn2()
{
  int n1 = 1;
  int n3 = 3;
  return (n1 == n3 ? 1 : 0);
}

int __tc_fn3()
{
  int n3 = 3;
  int n5 = 5;
  return (n5 > 10 ? 1 : (n5 > n3 ? 2 : 3));
}

int __tc_fn4()
{
  auto square = [=](int x) -> int {
  return x * x;
};
  return square(4);
}

int __tc_fn5()
{
  auto square = [=](int x) -> int {
  return x * x;
};
  return square(7);
}

int __tc_fn6()
{
  int scores[] = { 10, 20, 30, 40 };
  int total = 0;
  for (const int value : scores)
  {
    total += value;
  }
  return total;
}

void loop()
{
}
