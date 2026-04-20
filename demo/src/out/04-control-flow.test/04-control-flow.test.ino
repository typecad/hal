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
