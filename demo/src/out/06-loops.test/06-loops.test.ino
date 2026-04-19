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

// Auto-generated setup() for top-level statements
void setup()
{
  Serial.begin(115200);
  Serial.println("[TC:SUITE_START]");
  Serial.println("[TC:DESCRIBE:For loop (C-style)]");
  Serial.println("[TC:IT:basic for loop]");
  Serial.print("[TC:EXPECT:toBe:10:");
  Serial.print(__tc_fn1());
  Serial.println("]");
  Serial.println("[TC:IT:for loop with break]");
  Serial.print("[TC:EXPECT:toBe:3:");
  Serial.print(__tc_fn2());
  Serial.println("]");
  Serial.println("[TC:IT:for loop with continue]");
  Serial.print("[TC:EXPECT:toBe:9:");
  Serial.print(__tc_fn3());
  Serial.println("]");
  Serial.println("[TC:DESCRIBE:While loop]");
  Serial.println("[TC:IT:basic while loop]");
  Serial.print("[TC:EXPECT:toBe:24:");
  Serial.print(__tc_fn4());
  Serial.println("]");
  Serial.println("[TC:IT:while with break]");
  Serial.print("[TC:EXPECT:toBe:4:");
  Serial.print(__tc_fn5());
  Serial.println("]");
  Serial.println("[TC:DESCRIBE:Do-while loop]");
  Serial.println("[TC:IT:basic do-while]");
  Serial.print("[TC:EXPECT:toBe:3:");
  Serial.print(__tc_fn6());
  Serial.println("]");
  Serial.println("[TC:IT:do-while executes at least once]");
  Serial.print("[TC:EXPECT:toBe:1:");
  Serial.print(__tc_fn7());
  Serial.println("]");
  Serial.println("[TC:DESCRIBE:Switch statement]");
  Serial.println("[TC:IT:basic switch cases]");
  Serial.print("[TC:EXPECT:toBe:20:");
  Serial.print(__tc_fn8());
  Serial.println("]");
  Serial.println("[TC:IT:switch default case]");
  Serial.print("[TC:EXPECT:toBe:-1:");
  Serial.print(__tc_fn9());
  Serial.println("]");
  Serial.println("[TC:IT:switch with break between cases]");
  Serial.print("[TC:EXPECT:toBe:10:");
  Serial.print(__tc_fn10());
  Serial.println("]");
  Serial.println("[TC:DESCRIBE:For-in loop]");
  Serial.println("[TC:IT:iterate object keys]");
  Serial.print("[TC:EXPECT:toBe:3:");
  Serial.print(__tc_fn11());
  Serial.println("]");
  Serial.println("[TC:SUITE_END]");
  while (true)
  {
    delay(1000);
  }
}

int __tc_fn1()
{
  int sum = 0;
  for (int i = 0; i < 5; i++)
  {
    sum += i;
  }
  return sum;
}

int __tc_fn2()
{
  int sum = 0;
  for (int i = 0; i < 100; i++)
  {
    if (i >= 3)
    {
      break;
    }
    sum += i;
  }
  return sum;
}

int __tc_fn3()
{
  int sum = 0;
  for (int i = 0; i < 6; i++)
  {
    if (i % 2 == 0)
    {
      continue;
    }
    sum += i;
  }
  return sum;
}

int __tc_fn4()
{
  int n = 1;
  int result = 1;
  while (n < 5)
  {
    result *= n;
    n++;
  }
  return result;
}

int __tc_fn5()
{
  int i = 0;
  while (true)
  {
    if (i >= 4)
    {
      break;
    }
    i++;
  }
  return i;
}

int __tc_fn6()
{
  int count = 0;
  int i = 0;
  do
  {
    count++;
    i++;
  } while (i < 3);
  return count;
}

int __tc_fn7()
{
  int count = 0;
  int i = 10;
  do
  {
    count++;
    i++;
  } while (i < 10);
  return count;
}

int __tc_fn8()
{
  const int x = 2;
  switch (x)
  {
    case 1:
      return 10;
    case 2:
      return 20;
    case 3:
      return 30;
    default:
      return 0;
  }
}

int __tc_fn9()
{
  const int x = 99;
  switch (x)
  {
    case 1:
      return 10;
    case 2:
      return 20;
    default:
      return -1;
  }
}

int __tc_fn10()
{
  int result = 0;
  const int x = 1;
  switch (x)
  {
    case 1:
      result += 10;
      break;
    case 2:
      result += 20;
      break;
  }
  return result;
}

int __tc_fn11()
{
  struct _obj_t { int a; int b; int c; } obj = { 10, 20, 30 };
  int count = 0;
  for (const int key : obj)
  {
    count++;
  }
  return count;
}

void loop()
{
}
