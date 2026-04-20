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
int __tc_fn7();
int __tc_fn8();
int __tc_fn9();
int __tc_fn10();
int __tc_fn11();
int __tc_fn12();
int __tc_fn13();
int __tc_fn14();
int __tc_fn15();
int __tc_fn16();
int __tc_fn17();
int __tc_fn18();
int __tc_fn19();
int __tc_fn20();
int __tc_fn21();
int __tc_fn22();

// Auto-generated setup() for top-level statements
void setup()
{
  Serial.begin(115200);
  Serial.println("[TC:SUITE_START]");
  Serial.println("[TC:DESCRIBE:Comparison via ternary]");
  Serial.println("[TC:IT:equality and inequality]");
  Serial.print("[TC:EXPECT:toBe:1:");
  Serial.print(__tc_fn1());
  Serial.println("]");
  Serial.print("[TC:EXPECT:toBe:0:");
  Serial.print(__tc_fn2());
  Serial.println("]");
  Serial.print("[TC:EXPECT:toBe:1:");
  Serial.print(__tc_fn3());
  Serial.println("]");
  Serial.println("[TC:IT:less than / greater than]");
  Serial.print("[TC:EXPECT:toBe:1:");
  Serial.print(__tc_fn4());
  Serial.println("]");
  Serial.print("[TC:EXPECT:toBe:1:");
  Serial.print(__tc_fn5());
  Serial.println("]");
  Serial.print("[TC:EXPECT:toBe:0:");
  Serial.print(__tc_fn6());
  Serial.println("]");
  Serial.println("[TC:IT:less or equal / greater or equal]");
  Serial.print("[TC:EXPECT:toBe:1:");
  Serial.print(__tc_fn7());
  Serial.println("]");
  Serial.print("[TC:EXPECT:toBe:1:");
  Serial.print(__tc_fn8());
  Serial.println("]");
  Serial.print("[TC:EXPECT:toBe:1:");
  Serial.print(__tc_fn9());
  Serial.println("]");
  Serial.print("[TC:EXPECT:toBe:1:");
  Serial.print(__tc_fn10());
  Serial.println("]");
  Serial.println("[TC:DESCRIBE:Logical operators via numeric patterns]");
  Serial.println("[TC:IT:logical AND]");
  Serial.print("[TC:EXPECT:toBe:1:");
  Serial.print(__tc_fn11());
  Serial.println("]");
  Serial.print("[TC:EXPECT:toBe:0:");
  Serial.print(__tc_fn12());
  Serial.println("]");
  Serial.println("[TC:IT:logical OR]");
  Serial.print("[TC:EXPECT:toBe:1:");
  Serial.print(__tc_fn13());
  Serial.println("]");
  Serial.print("[TC:EXPECT:toBe:0:");
  Serial.print(__tc_fn14());
  Serial.println("]");
  Serial.println("[TC:IT:logical NOT]");
  Serial.print("[TC:EXPECT:toBe:1:");
  Serial.print(__tc_fn15());
  Serial.println("]");
  Serial.print("[TC:EXPECT:toBe:0:");
  Serial.print(__tc_fn16());
  Serial.println("]");
  Serial.println("[TC:DESCRIBE:Bitwise operators]");
  Serial.println("[TC:IT:AND, OR, XOR]");
  Serial.print("[TC:EXPECT:toBe:0x0F:");
  Serial.print(__tc_fn17());
  Serial.println("]");
  Serial.print("[TC:EXPECT:toBe:0xFF:");
  Serial.print(__tc_fn18());
  Serial.println("]");
  Serial.print("[TC:EXPECT:toBe:0xF0:");
  Serial.print(__tc_fn19());
  Serial.println("]");
  Serial.println("[TC:IT:shifts and NOT]");
  Serial.print("[TC:EXPECT:toBe:16:");
  Serial.print(__tc_fn20());
  Serial.println("]");
  Serial.print("[TC:EXPECT:toBe:16:");
  Serial.print(__tc_fn21());
  Serial.println("]");
  Serial.print("[TC:EXPECT:toBe:-1:");
  Serial.print(__tc_fn22());
  Serial.println("]");
  Serial.println("[TC:SUITE_END]");
  while (true)
  {
    delay(1000);
  }
}

int __tc_fn1()
{
  int n5 = 5;
  return (n5 == n5 ? 1 : 0);
}

int __tc_fn2()
{
  int n3 = 3;
  int n5 = 5;
  return (n5 == n3 ? 1 : 0);
}

int __tc_fn3()
{
  int n3 = 3;
  int n5 = 5;
  return (n5 != n3 ? 1 : 0);
}

int __tc_fn4()
{
  int n3 = 3;
  int n5 = 5;
  return (n3 < n5 ? 1 : 0);
}

int __tc_fn5()
{
  int n3 = 3;
  int n5 = 5;
  return (n5 > n3 ? 1 : 0);
}

int __tc_fn6()
{
  int n3 = 3;
  int n5 = 5;
  return (n5 < n3 ? 1 : 0);
}

int __tc_fn7()
{
  int n5 = 5;
  return (n5 <= n5 ? 1 : 0);
}

int __tc_fn8()
{
  int n3 = 3;
  int n5 = 5;
  return (n3 <= n5 ? 1 : 0);
}

int __tc_fn9()
{
  int n5 = 5;
  return (n5 >= n5 ? 1 : 0);
}

int __tc_fn10()
{
  int n3 = 3;
  int n5 = 5;
  return (n5 >= n3 ? 1 : 0);
}

int __tc_fn11()
{
  int n1 = 1;
  int n2 = 2;
  return (n1 == n1 && n2 == n2 ? 1 : 0);
}

int __tc_fn12()
{
  int n1 = 1;
  int n2 = 2;
  int n3 = 3;
  return (n1 == n1 && n2 == n3 ? 1 : 0);
}

int __tc_fn13()
{
  int n1 = 1;
  int n2 = 2;
  int n3 = 3;
  return (n1 == n1 || n2 == n3 ? 1 : 0);
}

int __tc_fn14()
{
  int n1 = 1;
  int n2 = 2;
  int n3 = 3;
  return (n1 == n3 || n2 == n3 ? 1 : 0);
}

int __tc_fn15()
{
  int n1 = 1;
  int n3 = 3;
  return (n1 != n3 ? 1 : 0);
}

int __tc_fn16()
{
  int n1 = 1;
  return (n1 != n1 ? 1 : 0);
}

int __tc_fn17()
{
  return 255 & 15;
}

int __tc_fn18()
{
  return 240 | 15;
}

int __tc_fn19()
{
  return 255 ^ 15;
}

int __tc_fn20()
{
  return 1 << 4;
}

int __tc_fn21()
{
  return 256 >> 4;
}

int __tc_fn22()
{
  return ~0;
}

void loop()
{
}
