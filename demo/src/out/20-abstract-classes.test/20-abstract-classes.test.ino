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

// Abstract class - contains pure virtual methods
class __tc_fn1__AbsReader {
public:
  virtual int read() = 0;

};

class __tc_fn1__ConReader : public __tc_fn1__AbsReader {
public:
  int read() {
    return 25;
  }

};

// Abstract class - contains pure virtual methods
class __tc_fn2__AbsPeripheral {
public:
  __tc_fn2__AbsPeripheral(int a) {
    this->addr = a;
  }

  int addr;

  virtual int getKind() = 0;

};

class __tc_fn2__I2CDev : public __tc_fn2__AbsPeripheral {
public:
  __tc_fn2__I2CDev(int a) : __tc_fn2__AbsPeripheral(a) {
  }

  int getKind() {
    return 1;
  }

};

// Abstract class - contains pure virtual methods
class __tc_fn3__AbsPin {
public:
  virtual int getNum() = 0;

};

class __tc_fn3__DigiPin : public __tc_fn3__AbsPin {
public:
  __tc_fn3__DigiPin(int n) : __tc_fn3__AbsPin() {
    this->n = n;
  }

  int n;

  int getNum() {
    return this->n;
  }

};

class __tc_fn3__AnaPin : public __tc_fn3__AbsPin {
public:
  __tc_fn3__AnaPin(int n) : __tc_fn3__AbsPin() {
    this->n = n + 100;
  }

  int n;

  int getNum() {
    return this->n;
  }

};

int __tc_fn1();
int __tc_fn2();
int __tc_fn3();

// Auto-generated setup() for top-level statements
void setup()
{
  Serial.begin(115200);
  Serial.println("[TC:SUITE_START]");
  Serial.println("[TC:DESCRIBE:Abstract classes]");
  Serial.println("[TC:IT:abstract class with concrete subclass]");
  Serial.print("[TC:EXPECT:toBe:25:");
  Serial.print(__tc_fn1());
  Serial.println("]");
  Serial.println("[TC:IT:abstract class with field and subclass]");
  Serial.print("[TC:EXPECT:toBe:0x69:");
  Serial.print(__tc_fn2());
  Serial.println("]");
  Serial.println("[TC:IT:abstract class with multiple concrete subclasses]");
  Serial.print("[TC:EXPECT:toBe:105:");
  Serial.print(__tc_fn3());
  Serial.println("]");
  Serial.println("[TC:SUITE_END]");
  while (true)
  {
    delay(1000);
  }
}

int __tc_fn1()
{
  const __tc_fn1__ConReader* s = new __tc_fn1__ConReader();
  return s->read();
}

int __tc_fn2()
{
  const __tc_fn2__I2CDev* dev = new __tc_fn2__I2CDev(104);
  return dev->addr + dev->getKind();
}

int __tc_fn3()
{
  const __tc_fn3__DigiPin* d = new __tc_fn3__DigiPin(5);
  const __tc_fn3__AnaPin* a = new __tc_fn3__AnaPin(0);
  return d->getNum() + a->getNum();
}

void loop()
{
}
