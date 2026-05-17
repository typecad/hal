#include <Arduino.h>
#include <stdio.h>

// TypeHAL Core Shims
#ifndef TYPEHAL_UNDEFINED
#define TYPEHAL_UNDEFINED 0
#endif

template<typename T> inline bool typehal_exists(T v) { return v != (T)TYPEHAL_UNDEFINED; }
template<typename T, typename U> inline T typehal_nullish(T a, U b) { return (a != (T)TYPEHAL_UNDEFINED) ? a : (T)b; }

// TypeHAL Native Polyfills
struct __tc_Num {
    struct MapChain {
        long v; long fl, fh;
        MapChain(long _v) : v(_v), fl(0), fh(1023) {}
        MapChain& from(long l, long h) { fl = l; fh = h; return *this; }
        long to(long l, long h) { return (v - fl) * (h - l) / (fh - fl) + l; }
        long toPercent() { return (v - fl) * 100 / (fh - fl); }
        long toByte() { return (v - fl) * 255 / (fh - fl); }
    };
    struct ConstrainChain {
        long v;
        ConstrainChain(long _v) : v(_v) {}
        long between(long l, long h) { return v < l ? l : (v > h ? h : v); }
    };
    static long (_abs)(long x) { return x < 0 ? -x : x; }
    static long (_min)(long a, long b) { return a < b ? a : b; }
    static long (_max)(long a, long b) { return a > b ? a : b; }
    static MapChain (_map)(long v) { return MapChain(v); }
    static ConstrainChain (_constrain)(long v) { return ConstrainChain(v); }
} Num;

struct __tc_Timing {
    unsigned long micros() { return ::micros(); }
    void delay(unsigned long ms) { ::delay(ms); }
    void delayMicroseconds(unsigned int us) { ::delayMicroseconds(us); }
    unsigned long freeHeap() {
        return 0;
    }
} Timing;


#ifndef TYPEHAL_STR_BUF_SIZE
#define TYPEHAL_STR_BUF_SIZE 64
#endif

// String helpers
struct __tc_str_ptr {
    char buf[TYPEHAL_STR_BUF_SIZE];
    __tc_str_ptr(const char* s = "") { strncpy(buf, s, TYPEHAL_STR_BUF_SIZE - 1); buf[TYPEHAL_STR_BUF_SIZE - 1] = 0; }
    __tc_str_ptr(const __tc_str_ptr& o) { memcpy(buf, o.buf, TYPEHAL_STR_BUF_SIZE); }
    __tc_str_ptr& operator=(const __tc_str_ptr& o) { memcpy(buf, o.buf, TYPEHAL_STR_BUF_SIZE); return *this; }
    __tc_str_ptr& operator=(const char* s) { strncpy(buf, s, TYPEHAL_STR_BUF_SIZE - 1); buf[TYPEHAL_STR_BUF_SIZE - 1] = 0; return *this; }
    const char* c_str() const { return buf; }
    size_t size() const { return strlen(buf); }
    size_t length() const { return strlen(buf); }
    int indexOf(const char* s) const { const char* p = strstr(buf, s); return p ? p - buf : -1; }
    operator const char*() const { return buf; }
    bool operator==(const char* o) const { return strcmp(buf, o) == 0; }
    bool operator!=(const char* o) const { return strcmp(buf, o) != 0; }
    bool operator==(const __tc_str_ptr& o) const { return strcmp(buf, o.buf) == 0; }
    bool operator!=(const __tc_str_ptr& o) const { return strcmp(buf, o.buf) != 0; }
};
inline size_t (strlen)(const __tc_str_ptr& s) { return ::strlen(s.buf); }
inline size_t (strlen)(const char* s) { return ::strlen(s); }

// Auto-generated setup() for top-level statements
void setup()
{
  Serial.begin(115200);
  Serial.println(__typehal_snprintf_0);
}

void loop()
{
}
