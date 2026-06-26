#include <Arduino.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

// TypeCAD Core Shims
#ifndef CUTTLEFISH_UNDEFINED
#define CUTTLEFISH_UNDEFINED 0
#endif

// Nullish helpers — overload set so value/struct types (which always
// exist) return false from the generic template, while scalars compare
// against CUTTLEFISH_UNDEFINED. The generic catch-all must NOT cast
// (T)CUTTLEFISH_UNDEFINED — that fails to compile for non-scalar T.

// TypeCAD Native Polyfills
#ifndef CUTTLEFISH_STR_BUF_SIZE
#define CUTTLEFISH_STR_BUF_SIZE 64
#endif

// String helpers
struct __tc_str_ptr {
    char buf[CUTTLEFISH_STR_BUF_SIZE];
    __tc_str_ptr(const char* s = "") { strncpy(buf, s, CUTTLEFISH_STR_BUF_SIZE - 1); buf[CUTTLEFISH_STR_BUF_SIZE - 1] = 0; }
    __tc_str_ptr(const __tc_str_ptr& o) { memcpy(buf, o.buf, CUTTLEFISH_STR_BUF_SIZE); }
    __tc_str_ptr& operator=(const __tc_str_ptr& o) { memcpy(buf, o.buf, CUTTLEFISH_STR_BUF_SIZE); return *this; }
    __tc_str_ptr& operator=(const char* s) { strncpy(buf, s, CUTTLEFISH_STR_BUF_SIZE - 1); buf[CUTTLEFISH_STR_BUF_SIZE - 1] = 0; return *this; }
    const char* c_str() const { return buf; }
    size_t size() const { return ::strlen(buf); }
    size_t length() const { return ::strlen(buf); }
    int indexOf(const char* s) const { const char* p = strstr(buf, s); return p ? p - buf : -1; }
    operator const char*() const { return buf; }
    bool operator==(const char* o) const { return strcmp(buf, o) == 0; }
    bool operator!=(const char* o) const { return strcmp(buf, o) != 0; }
    bool operator==(const __tc_str_ptr& o) const { return strcmp(buf, o.buf) == 0; }
    bool operator!=(const __tc_str_ptr& o) const { return strcmp(buf, o.buf) != 0; }
};
inline size_t (strlen)(const __tc_str_ptr& s) { return ::strlen(s.buf); }

// ── 1. Numeric const enum ──────────────────────────────────────────────────
enum class Mode {
  Idle = 0,
  Run = 1,
  Stop = 2,
  Error = 3
};

// ── 2. Enum with explicit gaps ─────────────────────────────────────────────
enum class Code {
  Ok = 0,
  NotFound = 404,
  ServerError = 500,
  Timeout = 408
};

// ── 3. String enum ─────────────────────────────────────────────────────────
namespace Color {
  constexpr const char* Red = "red";
  constexpr const char* Green = "green";
  constexpr const char* Blue = "blue";
}

// ── 10. Enum with bitwise flags ────────────────────────────────────────────
enum class Flags {
  None = 0,
  A = 1,
  B = 2,
  C = 4,
  All = 7
};

const Mode currentMode = Mode::Run;
const __tc_str_ptr currentColor = Color::Green;
// ── 4. Enum as array index ─────────────────────────────────────────────────
int32_t PRIORITY[] = { 10, 20, 30, 40 };

static int32_t priorityForMode(Mode m);
static bool isHighPriority(Code c);
static __tc_str_ptr describeMode(Mode m);
static bool isPrimary(__tc_str_ptr c);
static __tc_str_ptr colorName(__tc_str_ptr c);
static int32_t packMode(Mode m);
static Mode unpackMode(int32_t n);
static Mode nextMode(Mode m);
static bool hasFlag(int32_t flags, Flags f);
static int32_t defaultCode();

// Auto-generated setup() for top-level statements
void setup()
{
  Serial.begin(9600);
  pinMode(13, OUTPUT);
  cuttlefish_main();
}

static int32_t priorityForMode(Mode m)
{
  return PRIORITY[static_cast<int>(m)];
}

// ── 5. Enum relational comparison ──────────────────────────────────────────
static bool isHighPriority(Code c)
{
  return static_cast<int>(c) >= static_cast<int>(Code::ServerError);
}

// ── 6. Enum in switch ──────────────────────────────────────────────────────
static __tc_str_ptr describeMode(Mode m)
{
  if (m == Mode::Idle)
  {
    return "idle";
  } else if (m == Mode::Run)
  {
    return "running";
  } else if (m == Mode::Stop)
  {
    return "stopped";
  } else if (m == Mode::Error)
  {
    return "error";
  } else
  {
    return "unknown";
  }
}

// ── 7. String enum comparison and concat ───────────────────────────────────
static bool isPrimary(__tc_str_ptr c)
{
  return c == Color::Red;
}

static __tc_str_ptr colorName(__tc_str_ptr c)
{
  static char __cuttlefish_str_1[136];
  snprintf(__cuttlefish_str_1, sizeof(__cuttlefish_str_1), "color: %s", c.c_str());
  return __cuttlefish_str_1;
}

// ── 8. Enum↔integral storage boundary (Finding C: `as Mode` works) ─────────
static int32_t packMode(Mode m)
{
  return static_cast<int>(m);
}

static Mode unpackMode(int32_t n)
{
  return static_cast<Mode>(n);
}

// ── 9. Enum in arithmetic (Finding C: enum→int cast via member access) ─────
static Mode nextMode(Mode m)
{
  // enum→int via member access on an identifier is detected; the `as int32_t`
  // produces static_cast. Then +1, then `as Mode` back.
  return static_cast<Mode>(((static_cast<int32_t>(m)) + 1));
}

static bool hasFlag(int32_t flags, Flags f)
{
  return (flags & (static_cast<int32_t>(f))) != 0;
}

// ── 11. Enum member access ─────────────────────────────────────────────────
static int32_t defaultCode()
{
  return static_cast<int>(Code::Ok);
}

void cuttlefish_main()
{
  Serial.println(F("--- enum stress test ---"));
  char __cuttlefish_str_2[18];
  snprintf(__cuttlefish_str_2, sizeof(__cuttlefish_str_2), "mode=%d", static_cast<int>(currentMode));
  Serial.println(__cuttlefish_str_2);
  char __cuttlefish_str_3[18];
  snprintf(__cuttlefish_str_3, sizeof(__cuttlefish_str_3), "code=%d", static_cast<int>(Code::NotFound));
  Serial.println(__cuttlefish_str_3);
  Serial.println(colorName(currentColor));
  char __cuttlefish_str_4[139];
  snprintf(__cuttlefish_str_4, sizeof(__cuttlefish_str_4), "isPrimary=%s", ((isPrimary(Color::Red) ? "yes" : "no")));
  Serial.println(__cuttlefish_str_4);
  char __cuttlefish_str_5[18];
  snprintf(__cuttlefish_str_5, sizeof(__cuttlefish_str_5), "prio=%d", priorityForMode(Mode::Run));
  Serial.println(__cuttlefish_str_5);
  char __cuttlefish_str_6[138];
  snprintf(__cuttlefish_str_6, sizeof(__cuttlefish_str_6), "highPrio=%s", ((isHighPriority(Code::ServerError) ? "yes" : "no")));
  Serial.println(__cuttlefish_str_6);
  Serial.println(describeMode(Mode::Error));
  const int32_t packed = packMode(Mode::Stop);
  const Mode unpacked = unpackMode(packed);
  char __cuttlefish_str_7[42];
  snprintf(__cuttlefish_str_7, sizeof(__cuttlefish_str_7), "packed=%d unpacked=%d", packed, static_cast<int>(unpacked));
  Serial.println(__cuttlefish_str_7);
  const Mode nm = nextMode(Mode::Run);
  char __cuttlefish_str_8[18];
  snprintf(__cuttlefish_str_8, sizeof(__cuttlefish_str_8), "next=%d", static_cast<int>(nm));
  Serial.println(__cuttlefish_str_8);
  char __cuttlefish_str_9[134];
  snprintf(__cuttlefish_str_9, sizeof(__cuttlefish_str_9), "hasA=%s", ((hasFlag(static_cast<int>(Flags::A) | static_cast<int>(Flags::C), Flags::A) ? "yes" : "no")));
  Serial.println(__cuttlefish_str_9);
  char __cuttlefish_str_10[21];
  snprintf(__cuttlefish_str_10, sizeof(__cuttlefish_str_10), "default=%d", defaultCode());
  Serial.println(__cuttlefish_str_10);
  digitalWrite(13, HIGH);
  Serial.println(F("done"));
}

void loop()
{
}
