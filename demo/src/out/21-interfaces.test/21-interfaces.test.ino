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

class __tc_fn1__AnalogSensor {
public:
  __tc_fn1__AnalogSensor(int p) {
    this->pin = p;
  }

  int pin;

  int read() {
    return this->pin * 10;
  }

};

class __tc_fn2__SmartSensor {
public:
  __tc_fn2__SmartSensor() {
    this->setting = 1;
  }

  int setting;

  int read() {
    return this->setting * 100;
  }

  void configure(int s) {
    this->setting = s;
  }

};

class __tc_fn3__Thermistor {
public:
  __tc_fn3__Thermistor() {
    this->offset = 0;
  }

  int offset;

  int read() {
    return 22 + this->offset;
  }

  void setOffset(int o) {
    this->offset = o;
  }

};

class __tc_fn4__NamedSensor {
public:
  __tc_fn4__NamedSensor() {
    this->factor = 1;
  }

  int factor;

  int read() {
    return 42 * this->factor;
  }

  void setFactor(int f) {
    this->factor = f;
  }

};

int __tc_fn1();
int __tc_fn2();
int __tc_fn3();
int __tc_fn4();

// Auto-generated setup() for top-level statements
void setup()
{
  Serial.begin(115200);
  Serial.println("[TC:SUITE_START]");
  Serial.println("[TC:DESCRIBE:Interfaces]");
  Serial.println("[TC:IT:class implementing interface]");
  Serial.print("[TC:EXPECT:toBe:30:");
  Serial.print(__tc_fn1());
  Serial.println("]");
  Serial.println("[TC:IT:class with configure method]");
  Serial.print("[TC:EXPECT:toBe:500:");
  Serial.print(__tc_fn2());
  Serial.println("]");
  Serial.println("[TC:IT:sensor reading via method]");
  Serial.print("[TC:EXPECT:toBe:27:");
  Serial.print(__tc_fn3());
  Serial.println("]");
  Serial.println("[TC:IT:named sensor with configure and read]");
  Serial.print("[TC:EXPECT:toBe:84:");
  Serial.print(__tc_fn4());
  Serial.println("]");
  Serial.println("[TC:SUITE_END]");
  while (true)
  {
    delay(1000);
  }
}

int __tc_fn1()
{
  const __tc_fn1__AnalogSensor* s = new __tc_fn1__AnalogSensor(3);
  return s->read();
}

int __tc_fn2()
{
  const __tc_fn2__SmartSensor* s = new __tc_fn2__SmartSensor();
  s->configure(5);
  return s->read();
}

int __tc_fn3()
{
  const __tc_fn3__Thermistor* t = new __tc_fn3__Thermistor();
  t->setOffset(5);
  return t->read();
}

int __tc_fn4()
{
  const __tc_fn4__NamedSensor* s = new __tc_fn4__NamedSensor();
  s->setFactor(2);
  return s->read();
}

void loop()
{
}
