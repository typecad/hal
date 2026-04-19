#include <Arduino.h>

int __tc_fn1();
int __tc_fn2();
int __tc_fn3();
int __tc_fn4();
int __tc_fn5();

// Auto-generated setup() for top-level statements
void setup()
{
  Serial.begin(115200);
  Serial.println("[TC:SUITE_START]");
  Serial.println("[TC:DESCRIBE:Variables and Scoping]");
  Serial.println("[TC:IT:const and let assignment]");
  Serial.print("[TC:EXPECT:toBe:15:");
  Serial.print(__tc_fn1());
  Serial.println("]");
  Serial.println("[TC:IT:block scoping (shadowing)]");
  Serial.print("[TC:EXPECT:toBe:1:");
  Serial.print(__tc_fn2());
  Serial.println("]");
  Serial.println("[TC:IT:object destructuring and aliasing]");
  Serial.print("[TC:EXPECT:toBe:42:");
  Serial.print(__tc_fn3());
  Serial.println("]");
  Serial.println("[TC:IT:nested object destructuring]");
  Serial.print("[TC:EXPECT:toBe:200:");
  Serial.print(__tc_fn4());
  Serial.println("]");
  Serial.println("[TC:IT:array destructuring with rest]");
  Serial.print("[TC:EXPECT:toBe:2:");
  Serial.print(__tc_fn5());
  Serial.println("]");
  Serial.println("[TC:SUITE_END]");
  while (true)
  {
    delay(1000);
  }
}

int __tc_fn1()
{
  const int fixed = 10;
  int mutable_ = 5;
  mutable_ += fixed;
  return mutable_;
}

int __tc_fn2()
{
  int x = 1;
  {
    int x = 2;
    // Should not overwrite outer x in C++
  }
  return x;
}

int __tc_fn3()
{
  struct _user_t { int id; const char* name; } user = { 42, "Alice" };
  const int userId = user.id;
  const int name = user.name;
  return userId;
}

int __tc_fn4()
{
  struct _meta_data_t { int status; };
  struct _meta_t { _meta_data_t data; } meta = { { 200 } };
  const int status = meta.data.status;
  return status;
}

int __tc_fn5()
{
  const int first = 10;
  const int second = 20;
  int rest[] = { 30, 40 };
  return (sizeof(rest) / sizeof(rest[0]));
}

void loop()
{
}
