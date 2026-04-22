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

namespace SensorLib {

  const int BASE = 42;
  const int OFFSET = 8;

} // namespace SensorLib

namespace MathUtils {

  int twice(int x) {
    return x * 2;
  }

} // namespace MathUtils

class __tc_fn3__AddrLib {
public:
  static int read() {
    return 104;
  }

};

class __tc_fn4__I2CBusDev {
public:
  __tc_fn4__I2CBusDev(int addr) {
    this->address = addr;
  }

  int address;

  int getAddress() {
    return this->address;
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
  Serial.println("[TC:DESCRIBE:Namespaced organization]");
  Serial.println("[TC:IT:namespace constant access]");
  Serial.print("[TC:EXPECT:toBe:50:");
  Serial.print(__tc_fn1());
  Serial.println("]");
  Serial.println("[TC:IT:namespace function call]");
  Serial.print("[TC:EXPECT:toBe:10:");
  Serial.print(__tc_fn2());
  Serial.println("]");
  Serial.println("[TC:IT:static class method as library]");
  Serial.print("[TC:EXPECT:toBe:0x68:");
  Serial.print(__tc_fn3());
  Serial.println("]");
  Serial.println("[TC:IT:class instantiation in IIFE]");
  Serial.print("[TC:EXPECT:toBe:0x55:");
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
  return SensorLib::BASE + SensorLib::OFFSET;
}

int __tc_fn2()
{
  return MathUtils::twice(5);
}

int __tc_fn3()
{
  return __tc_fn3__AddrLib::read();
}

int __tc_fn4()
{
  const __tc_fn4__I2CBusDev* bus = new __tc_fn4__I2CBusDev(85);
  return bus->getAddress();
}

void loop()
{
}
