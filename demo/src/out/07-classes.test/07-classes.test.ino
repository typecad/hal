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

class __tc_fn1__Point {
public:
  __tc_fn1__Point(int x, int y) {
    this->x = x;
    this->y = y;
  }

  int x;
  int y;

};

class __tc_fn2__Calculator {
public:
  __tc_fn2__Calculator() {
    this->value = 0;
  }

  int value;

  int add(int n) {
    this->value += n;
    return this->value;
  }

};

class __tc_fn3__Rect {
public:
  __tc_fn3__Rect(int w, int h) {
    this->width = w;
    this->height = h;
  }

  int width;
  int height;

  int area() {
    return this->width * this->height;
  }

};

class __tc_fn4__Animal {
public:
  __tc_fn4__Animal(const char* name) {
    this->name = name;
  }

  const char* name;

  const char* identify() {
    return this->name;
  }

};

class __tc_fn4__Dog : public __tc_fn4__Animal {
public:
  __tc_fn4__Dog(const char* name, const char* breed) : __tc_fn4__Animal(name) {
    this->breed = breed;
  }

  const char* breed;

};

class __tc_fn5__MathUtils {
public:
  static int double_(int n) {
    return n * 2;
  }

};

class __tc_fn6__Builder {
public:
  __tc_fn6__Builder() {
    this->value = 0;
  }

  int value;

  __tc_fn6__Builder* add(int n) {
    this->value += n;
    return this;
  }

};

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
  Serial.println("[TC:DESCRIBE:Class basics]");
  Serial.println("[TC:IT:constructor and fields]");
  Serial.print("[TC:EXPECT:toBe:7:");
  Serial.print(__tc_fn1());
  Serial.println("]");
  Serial.println("[TC:IT:method invocation]");
  Serial.print("[TC:EXPECT:toBe:8:");
  Serial.print(__tc_fn2());
  Serial.println("]");
  Serial.println("[TC:IT:method returning value]");
  Serial.print("[TC:EXPECT:toBe:20:");
  Serial.print(__tc_fn3());
  Serial.println("]");
  Serial.println("[TC:DESCRIBE:Class inheritance]");
  Serial.println("[TC:IT:extends with super]");
  Serial.print("[TC:EXPECT:toBe:3:");
  Serial.print(__tc_fn4());
  Serial.println("]");
  Serial.println("[TC:DESCRIBE:Static members]");
  Serial.println("[TC:IT:static method]");
  Serial.print("[TC:EXPECT:toBe:14:");
  Serial.print(__tc_fn5());
  Serial.println("]");
  Serial.println("[TC:DESCRIBE:This keyword]");
  Serial.println("[TC:IT:this in method chain]");
  Serial.print("[TC:EXPECT:toBe:10:");
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
  const __tc_fn1__Point* p = new __tc_fn1__Point(3, 4);
  return p->x + p->y;
}

int __tc_fn2()
{
  const __tc_fn2__Calculator* calc = new __tc_fn2__Calculator();
  calc->add(5);
  calc->add(3);
  return calc->value;
}

int __tc_fn3()
{
  const __tc_fn3__Rect* r = new __tc_fn3__Rect(4, 5);
  return r->area();
}

int __tc_fn4()
{
  const __tc_fn4__Dog* d = new __tc_fn4__Dog("Rex", "Shepherd");
  return strlen(d->identify());
}

int __tc_fn5()
{
  return __tc_fn5__MathUtils::double_(7);
}

int __tc_fn6()
{
  const __tc_fn6__Builder* b = new __tc_fn6__Builder();
  b->add(3)->add(7);
  return b->value;
}

void loop()
{
}
