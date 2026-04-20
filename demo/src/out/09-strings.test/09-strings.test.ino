#include <Arduino.h>
#include <stdio.h>
#include <stdlib.h>

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

const char* __tc_fn1();
int __tc_fn2();
const char* __tc_fn3();
const char* __tc_fn4();
const char* __tc_fn5();
int __tc_fn6();

// Auto-generated setup() for top-level statements
void setup()
{
  Serial.begin(115200);
  Serial.println("[TC:SUITE_START]");
  Serial.println("[TC:DESCRIBE:String literals]");
  Serial.println("[TC:IT:string length]");
  Serial.print("[TC:EXPECT:toBe:");
  Serial.print("hello");
  Serial.print(":");
  Serial.print(__tc_fn1());
  Serial.println("]");
  Serial.println("[TC:IT:string property access via length]");
  Serial.print("[TC:EXPECT:toBe:5:");
  Serial.print(__tc_fn2());
  Serial.println("]");
  Serial.println("[TC:DESCRIBE:String concatenation]");
  Serial.println("[TC:IT:concat with + operator]");
  Serial.print("[TC:EXPECT:toBe:");
  Serial.print("hello world");
  Serial.print(":");
  Serial.print(__tc_fn3());
  Serial.println("]");
  Serial.println("[TC:DESCRIBE:Template literals]");
  Serial.println("[TC:IT:basic template literal]");
  Serial.print("[TC:EXPECT:toBe:");
  Serial.print("Hello TypeCode");
  Serial.print(":");
  Serial.print(__tc_fn4());
  Serial.println("]");
  Serial.println("[TC:IT:template literal with expression]");
  Serial.print("[TC:EXPECT:toBe:");
  Serial.print("3 + 4 = 7");
  Serial.print(":");
  Serial.print(__tc_fn5());
  Serial.println("]");
  Serial.println("[TC:IT:template literal with number interpolation]");
  Serial.print("[TC:EXPECT:toBe:5:");
  Serial.print(__tc_fn6());
  Serial.println("]");
  Serial.println("[TC:SUITE_END]");
  while (true)
  {
    delay(1000);
  }
}

const char* __tc_fn1()
{
  const char* greeting = "hello";
  return greeting;
}

int __tc_fn2()
{
  const char* greeting = "hello";
  return strlen(greeting);
}

const char* __tc_fn3()
{
  const char* first = "hello";
  const char* second = " world";
  static char __typecode_str_1[65];
  snprintf(__typecode_str_1, sizeof(__typecode_str_1), "%s%s", first, second);
  return __typecode_str_1;
}

const char* __tc_fn4()
{
  const char* name = "TypeCode";
  static char __typecode_str_1[39];
  snprintf(__typecode_str_1, sizeof(__typecode_str_1), "Hello %s", name);
  return __typecode_str_1;
}

const char* __tc_fn5()
{
  const int a = 3;
  const int b = 4;
  static char __typecode_str_1[43];
  snprintf(__typecode_str_1, sizeof(__typecode_str_1), "%d + %d = %d", a, b, a + b);
  return __typecode_str_1;
}

int __tc_fn6()
{
  const char* template_ = "value";
  return strlen(template_);
}

void loop()
{
}
