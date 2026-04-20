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
