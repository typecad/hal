#include <Arduino.h>

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

class __tc_fn1__Sensor {
public:
  __tc_fn1__Sensor(int v) {
    this->_value = v;
  }

  int _value;

  int getReading() const {
    return this->_value;
  }

};

class __tc_fn2__Rect {
public:
  __tc_fn2__Rect(int width, int height) {
    this->w = width;
    this->h = height;
  }

  int w;
  int h;

  int getArea() const {
    return this->w * this->h;
  }

};

class __tc_fn3__Counter {
public:
  __tc_fn3__Counter() {
    this->_count = 0;
  }

  int _count;

  int getCount() const {
    return this->_count;
  }

  void setCount(int val) {
    this->_count = val;
  }

};

class __tc_fn4__Bounded {
public:
  __tc_fn4__Bounded() {
    this->_val = 0;
  }

  int _val;

  int getVal() const {
    return this->_val;
  }

  void setVal(int v) {
    if (v > 100)
    {
      this->_val = 100;
    }
    else {
      this->_val = v;
    }
  }

};

class __tc_fn5__Temp {
public:
  __tc_fn5__Temp() {
    this->_celsius = 0;
  }

  int _celsius;

  int getCelsius() const {
    return this->_celsius;
  }

  void setCelsius(int c) {
    this->_celsius = c;
  }

};

class __tc_fn14__Base {
public:
  __tc_fn14__Base() {
    this->_x = 10;
  }

  int _x;

};

class __tc_fn14__Derived : public __tc_fn14__Base {
public:
  int getDoubled() const {
    return this->_x * 2;
  }

};

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
int __tc_fn13();
int __tc_fn14();
int __tc_fn12__getNullable();
const char* __tc_fn13__getName();

// Auto-generated setup() for top-level statements
void setup()
{
  Serial.begin(115200);
  Serial.println("[TC:SUITE_START]");
  Serial.println("[TC:DESCRIBE:Getter accessors]");
  Serial.println("[TC:IT:getter returns field value]");
  Serial.print("[TC:EXPECT:toBe:42:");
  Serial.print(__tc_fn1());
  Serial.println("]");
  Serial.println("[TC:IT:getter computes derived value]");
  Serial.print("[TC:EXPECT:toBe:21:");
  Serial.print(__tc_fn2());
  Serial.println("]");
  Serial.println("[TC:DESCRIBE:Setter accessors]");
  Serial.println("[TC:IT:setter updates field value]");
  Serial.print("[TC:EXPECT:toBe:10:");
  Serial.print(__tc_fn3());
  Serial.println("]");
  Serial.println("[TC:IT:setter clamps value]");
  Serial.print("[TC:EXPECT:toBe:100:");
  Serial.print(__tc_fn4());
  Serial.println("]");
  Serial.println("[TC:DESCRIBE:Getter and setter pair]");
  Serial.println("[TC:IT:read/write through accessors]");
  Serial.print("[TC:EXPECT:toBe:25:");
  Serial.print(__tc_fn5());
  Serial.println("]");
  Serial.println("[TC:DESCRIBE:forEach expansion]");
  Serial.println("[TC:IT:forEach sums array elements]");
  Serial.print("[TC:EXPECT:toBe:15:");
  Serial.print(__tc_fn6());
  Serial.println("]");
  Serial.println("[TC:IT:forEach with block body counts elements]");
  Serial.print("[TC:EXPECT:toBe:3:");
  Serial.print(__tc_fn7());
  Serial.println("]");
  Serial.println("[TC:IT:forEach modifies external state]");
  Serial.print("[TC:EXPECT:toBe:48:");
  Serial.print(__tc_fn8());
  Serial.println("]");
  Serial.println("[TC:DESCRIBE:typeof operator]");
  Serial.println("[TC:IT:typeof number literal equals number]");
  Serial.print("[TC:EXPECT:toBe:1:");
  Serial.print(__tc_fn9());
  Serial.println("]");
  Serial.println("[TC:IT:typeof string literal equals string]");
  Serial.print("[TC:EXPECT:toBe:1:");
  Serial.print(__tc_fn10());
  Serial.println("]");
  Serial.println("[TC:IT:typeof boolean literal equals boolean]");
  Serial.print("[TC:EXPECT:toBe:1:");
  Serial.print(__tc_fn11());
  Serial.println("]");
  Serial.println("[TC:DESCRIBE:Nullable union types]");
  Serial.println("[TC:IT:number | null resolves to number]");
  Serial.print("[TC:EXPECT:toBe:42:");
  Serial.print(__tc_fn12());
  Serial.println("]");
  Serial.println("[TC:IT:string | undefined resolves to string]");
  Serial.print("[TC:EXPECT:toBe:1:");
  Serial.print(__tc_fn13());
  Serial.println("]");
  Serial.println("[TC:DESCRIBE:Accessors with inheritance]");
  Serial.println("[TC:IT:derived class getter uses base field]");
  Serial.print("[TC:EXPECT:toBe:20:");
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
  const __tc_fn1__Sensor* s = new __tc_fn1__Sensor(42);
  return s->getReading();
}

int __tc_fn2()
{
  const __tc_fn2__Rect* r = new __tc_fn2__Rect(3, 7);
  return r->getArea();
}

int __tc_fn3()
{
  const __tc_fn3__Counter* c = new __tc_fn3__Counter();
  c->setCount(10);
  return c->getCount();
}

int __tc_fn4()
{
  const __tc_fn4__Bounded* b = new __tc_fn4__Bounded();
  b->setVal(200);
  return b->getVal();
}

int __tc_fn5()
{
  const __tc_fn5__Temp* t = new __tc_fn5__Temp();
  t->setCelsius(25);
  return t->getCelsius();
}

int __tc_fn6()
{
  int nums[] = { 1, 2, 3, 4, 5 };
  int sum = 0;
  for (int __tc_i = 0; __tc_i < 5; __tc_i++)
  {
    const int x = nums[__tc_i];
    sum += x;
  }
  return sum;
}

int __tc_fn7()
{
  int items[] = { 10, 20, 30 };
  int count = 0;
  for (int __tc_i = 0; __tc_i < 3; __tc_i++)
  {
    const int item = items[__tc_i];
    count++;
  }
  return count;
}

int __tc_fn8()
{
  int values[] = { 2, 4, 6 };
  int product = 1;
  for (int __tc_i = 0; __tc_i < 3; __tc_i++)
  {
    const int v = values[__tc_i];
    product *= v;
  }
  return product;
}

int __tc_fn9()
{
  const char* t = "number";
  return (t == "number" ? 1 : 0);
}

int __tc_fn10()
{
  const char* t = "string";
  return (t == "string" ? 1 : 0);
}

int __tc_fn11()
{
  const char* t = "boolean";
  return (t == "boolean" ? 1 : 0);
}

int __tc_fn12()
{
  const int val = __tc_fn12__getNullable();
  return val;
}

int __tc_fn13()
{
  const int name = __tc_fn13__getName();
  return (name == "test" ? 1 : 0);
}

int __tc_fn14()
{
  const __tc_fn14__Derived* d = new __tc_fn14__Derived();
  return d->getDoubled();
}

int __tc_fn12__getNullable()
{
  return 42;
}

const char* __tc_fn13__getName()
{
  return "test";
}

void loop()
{
}
