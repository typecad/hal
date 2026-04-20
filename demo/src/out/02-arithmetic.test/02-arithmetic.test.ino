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
float __tc_fn13();
int __tc_fn14();
int __tc_fn15();
int __tc_fn16();
int __tc_fn17();
int __tc_fn18();

// Auto-generated setup() for top-level statements
void setup()
{
  Serial.begin(115200);
  Serial.println("[TC:SUITE_START]");
  Serial.println("[TC:DESCRIBE:Arithmetic operators]");
  Serial.println("[TC:IT:division and modulo]");
  Serial.print("[TC:EXPECT:toBe:1:");
  Serial.print(__tc_fn1());
  Serial.println("]");
  Serial.print("[TC:EXPECT:toBe:1:");
  Serial.print(__tc_fn2());
  Serial.println("]");
  Serial.println("[TC:IT:unary negation]");
  Serial.print("[TC:EXPECT:toBe:-1:");
  Serial.print(__tc_fn3());
  Serial.println("]");
  Serial.print("[TC:EXPECT:toBe:42:");
  Serial.print(__tc_fn4());
  Serial.println("]");
  Serial.println("[TC:IT:order of operations]");
  Serial.print("[TC:EXPECT:toBe:14:");
  Serial.print(__tc_fn5());
  Serial.println("]");
  Serial.println("[TC:IT:parenthesized expressions]");
  Serial.print("[TC:EXPECT:toBe:20:");
  Serial.print(__tc_fn6());
  Serial.println("]");
  Serial.print("[TC:EXPECT:toBe:14:");
  Serial.print(__tc_fn7());
  Serial.println("]");
  Serial.print("[TC:EXPECT:toBe:21:");
  Serial.print(__tc_fn8());
  Serial.println("]");
  Serial.println("[TC:DESCRIBE:Number literals]");
  Serial.println("[TC:IT:hex literal]");
  Serial.print("[TC:EXPECT:toBe:255:");
  Serial.print(__tc_fn9());
  Serial.println("]");
  Serial.println("[TC:IT:binary literal]");
  Serial.print("[TC:EXPECT:toBe:10:");
  Serial.print(__tc_fn10());
  Serial.println("]");
  Serial.println("[TC:IT:octal literal]");
  Serial.print("[TC:EXPECT:toBe:63:");
  Serial.print(__tc_fn11());
  Serial.println("]");
  Serial.println("[TC:IT:negative literal]");
  Serial.print("[TC:EXPECT:toBe:-42:");
  Serial.print(__tc_fn12());
  Serial.println("]");
  Serial.println("[TC:IT:floating point literal]");
  Serial.print("[TC:EXPECT:toBeCloseTo:3.14,1:");
  Serial.print(__tc_fn13());
  Serial.println("]");
  Serial.println("[TC:DESCRIBE:Compound assignment]");
  Serial.println("[TC:IT:+=, -=, *=, /=]");
  Serial.print("[TC:EXPECT:toBe:10:");
  Serial.print(__tc_fn14());
  Serial.println("]");
  Serial.print("[TC:EXPECT:toBe:15:");
  Serial.print(__tc_fn15());
  Serial.println("]");
  Serial.print("[TC:EXPECT:toBe:12:");
  Serial.print(__tc_fn16());
  Serial.println("]");
  Serial.print("[TC:EXPECT:toBe:24:");
  Serial.print(__tc_fn17());
  Serial.println("]");
  Serial.print("[TC:EXPECT:toBe:6:");
  Serial.print(__tc_fn18());
  Serial.println("]");
  Serial.println("[TC:SUITE_END]");
  while (true)
  {
    delay(1000);
  }
}

int __tc_fn1()
{
  return 10 % 3;
}

int __tc_fn2()
{
  return 7 % 2;
}

int __tc_fn3()
{
  const int a = 1;
  return -a;
}

int __tc_fn4()
{
  const int negative = -42;
  return -negative;
}

int __tc_fn5()
{
  return 2 + 3 * 4;
}

int __tc_fn6()
{
  return (2 + 3) * 4;
}

int __tc_fn7()
{
  return 2 * (3 + 4);
}

int __tc_fn8()
{
  return (1 + 2) * (3 + 4);
}

int __tc_fn9()
{
  const int hex = 255;
  return hex;
}

int __tc_fn10()
{
  const int binary = 10;
  return binary;
}

int __tc_fn11()
{
  const int octal = 63;
  return octal;
}

int __tc_fn12()
{
  const int negative = -42;
  return negative;
}

float __tc_fn13()
{
  const float floating = 3.14f;
  return floating;
}

int __tc_fn14()
{
  int mut = 10;
  return mut;
}

int __tc_fn15()
{
  int mut = 10;
  mut += 5;
  return mut;
}

int __tc_fn16()
{
  int mut = 10;
  mut += 5;
  mut -= 3;
  return mut;
}

int __tc_fn17()
{
  int mut = 10;
  mut += 5;
  mut -= 3;
  mut *= 2;
  return mut;
}

int __tc_fn18()
{
  int mut = 10;
  mut += 5;
  mut -= 3;
  mut *= 2;
  mut /= 4;
  return mut;
}

void loop()
{
}
