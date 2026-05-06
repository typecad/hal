#include <Arduino.h>

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
    unsigned long millis() { return ::millis(); }
    unsigned long micros() { return ::micros(); }
    void delay(unsigned long ms) { ::delay(ms); }
    void delayMicroseconds(unsigned int us) { ::delayMicroseconds(us); }
    unsigned long freeHeap() {
#if defined(ESP32)
        return ESP.getFreeHeap();
#elif defined(__AVR__)
        extern int __heap_start, *__brkval;
        int v;
        return (unsigned long) &v - (__brkval == 0 ? (unsigned long) &__heap_start : (unsigned long) __brkval);
#else
        return 0;
#endif
    }
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

// ── State machine state ───────────────────────────────────────────────────
int blinkPhase = 0;
int lastBlinkTime = 0;
int buzzerPhase = 0;
int lastBuzzerTime = 0;
int buttonState = 0;
int edgeTime = 0;
int edgeTimeout = 0;

// ── Entry point ───────────────────────────────────────────────────────────
void setup()
{
  Serial.begin(115200);
  pinMode(4, INPUT_PULLUP);
  pinMode(13, OUTPUT);
  digitalWrite(13, false);
  pinMode(9, OUTPUT);
  digitalWrite(9, false);
  Serial.println("== TypeHAL Arduino Uno Demo ==");
  Serial.println("Board: Arduino Uno (ATmega328P)");
  Serial.println("Features: LED blink, button input, buzzer tone");
}

void loop()
{
  const auto now = millis();
  // ── Blink LED every 500ms ─────────────────────────────────────────────
  if (now - lastBlinkTime >= 500)
  {
    lastBlinkTime = now;
    if (blinkPhase == 0)
    {
      digitalWrite(13, true);
      blinkPhase = 1;
    }
    else {
      digitalWrite(13, false);
      blinkPhase = 0;
    }
  }
  // ── Button edge detection ──────────────────────────────────────────────
  const auto btnLow = !digitalRead(4) == HIGH;
  // INPUT_PULLUP = active low
  // Wait for press
  if (buttonState == 0 && btnLow)
  {
    buttonState = 1;
    edgeTime = now;
    Serial.println("  Button pressed!");
  }
  // Debounce 50ms, then wait for release or timeout
  if (buttonState == 1 && !btnLow && (now - edgeTime >= 50))
  {
    buttonState = 0;
    edgeTime = now;
    Serial.println("  Button released!");
    tone(9, 880);
    buzzerPhase = 1;
    lastBuzzerTime = now;
  }
  // ── Buzzer tone duration (300ms) ──────────────────────────────────────
  if (buzzerPhase == 1 && (now - lastBuzzerTime >= 300))
  {
    noTone(9);
    buzzerPhase = 0;
  }
}
