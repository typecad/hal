#include <Arduino.h>
#include <Wire.h>

struct __tc_TimerTask {
    void (*callback)();
    unsigned long interval;
    unsigned long lastRun;
    bool repeat;
    bool active;
};

class __tc_TimerRuntime {
    static const int MAX_TIMERS = 8;
    __tc_TimerTask tasks[MAX_TIMERS];
public:
    __tc_TimerRuntime() {
        for (int i=0; i<MAX_TIMERS; i++) tasks[i].active = false;
    }
    int add(void (*cb)(), unsigned long ms, bool repeat) {
        for (int i=0; i<MAX_TIMERS; i++) {
            if (!tasks[i].active) {
                tasks[i].callback = cb;
                tasks[i].interval = ms;
                tasks[i].lastRun = millis();
                tasks[i].repeat = repeat;
                tasks[i].active = true;
                return i + 1;
            }
        }
        return 0;
    }
    void clear(int id) {
        if (id > 0 && id <= MAX_TIMERS) tasks[id-1].active = false;
    }
    void run() {
        unsigned long now = millis();
        for (int i=0; i<MAX_TIMERS; i++) {
            if (tasks[i].active && (now - tasks[i].lastRun >= tasks[i].interval)) {
                tasks[i].callback();
                if (tasks[i].repeat) {
                    tasks[i].lastRun = now;
                } else {
                    tasks[i].active = false;
                }
            }
        }
    }
} __tc_timer_runtime;

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
} Timing;

#if defined(__AVR__)
#include <avr/wdt.h>
#include <string.h>
struct __tc_WDT {
    void (enable)(const char* t) {
        if (strcmp(t, "15ms") == 0) wdt_enable(WDTO_15MS);
        else if (strcmp(t, "30ms") == 0) wdt_enable(WDTO_30MS);
        else if (strcmp(t, "60ms") == 0) wdt_enable(WDTO_60MS);
        else if (strcmp(t, "120ms") == 0) wdt_enable(WDTO_120MS);
        else if (strcmp(t, "250ms") == 0) wdt_enable(WDTO_250MS);
        else if (strcmp(t, "500ms") == 0) wdt_enable(WDTO_500MS);
        else if (strcmp(t, "1s") == 0) wdt_enable(WDTO_1S);
        else if (strcmp(t, "2s") == 0) wdt_enable(WDTO_2S);
        else if (strcmp(t, "4s") == 0) wdt_enable(WDTO_4S);
        else if (strcmp(t, "8s") == 0) wdt_enable(WDTO_8S);
    }
    void (enable)(int t) { wdt_enable(t); }
    void (reset)() { wdt_reset(); }
    void (disable)() { wdt_disable(); }
} WDT;
#endif

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
  // Take the bus
  const auto bus = I2C0.take();
  Wire.begin();
  // Double take
  const auto bus2 = I2C0.take();
  // Release
  I2C0.release();
  Wire.setClock(400000);
}

void loop()
{
}
