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

// String helpers
struct __tc_str_ptr {
    char buf[32];
    __tc_str_ptr(const char* s = "") { strncpy(buf, s, 31); buf[31] = 0; }
    __tc_str_ptr(const __tc_str_ptr& o) { memcpy(buf, o.buf, 32); }
    __tc_str_ptr& operator=(const __tc_str_ptr& o) { memcpy(buf, o.buf, 32); return *this; }
    __tc_str_ptr& operator=(const char* s) { strncpy(buf, s, 31); buf[31] = 0; return *this; }
    const char* c_str() const { return buf; }
    size_t size() const { return strlen(buf); }
    size_t length() const { return strlen(buf); }
    operator const char*() const { return buf; }
    bool operator==(const char* o) const { return strcmp(buf, o) == 0; }
    bool operator!=(const char* o) const { return strcmp(buf, o) != 0; }
    bool operator==(const __tc_str_ptr& o) const { return strcmp(buf, o.buf) == 0; }
    bool operator!=(const __tc_str_ptr& o) const { return strcmp(buf, o.buf) != 0; }
};
inline size_t (strlen)(const __tc_str_ptr& s) { return strlen(s.buf); }
inline size_t (strlen)(const char* s) { return ::strlen(s); }

class __tc_fn1__Point {
public:
  __tc_fn1__Point(int x, int y) {
    this->x = x;
    this->y = y;
  }

  int x;
  int y;

};

class __tc_fn2__Calculator {
public:
  __tc_fn2__Calculator() {
    this->value = 0;
  }

  int value;

  int add(int n) {
    this->value += n;
    return this->value;
  }

};

class __tc_fn3__Rect {
public:
  __tc_fn3__Rect(int w, int h) {
    this->width = w;
    this->height = h;
  }

  int width;
  int height;

  int area() {
    return this->width * this->height;
  }

};

class __tc_fn4__Animal {
public:
  __tc_fn4__Animal(__tc_str_ptr name) {
    this->name = name;
  }

  __tc_str_ptr name;

  __tc_str_ptr identify() {
    return this->name;
  }

};

class __tc_fn4__Dog : public __tc_fn4__Animal {
public:
  __tc_fn4__Dog(__tc_str_ptr name, __tc_str_ptr breed) : __tc_fn4__Animal(name) {
    this->breed = breed;
  }

  __tc_str_ptr breed;

};

class __tc_fn5__MathUtils {
public:
  static int double_(int n) {
    return n * 2;
  }

};

class __tc_fn6__Builder {
public:
  __tc_fn6__Builder() {
    this->value = 0;
  }

  int value;

  __tc_fn6__Builder* add(int n) {
    this->value += n;
    return this;
  }

};

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
  Serial.println("[TC:DESCRIBE:Class basics]");
  Serial.println("[TC:IT:constructor and fields]");
  Serial.print("[TC:EXPECT:toBe:7:");
  Serial.print(__tc_fn1());
  Serial.println("]");
  Serial.println("[TC:IT:method invocation]");
  Serial.print("[TC:EXPECT:toBe:8:");
  Serial.print(__tc_fn2());
  Serial.println("]");
  Serial.println("[TC:IT:method returning value]");
  Serial.print("[TC:EXPECT:toBe:20:");
  Serial.print(__tc_fn3());
  Serial.println("]");
  Serial.println("[TC:DESCRIBE:Class inheritance]");
  Serial.println("[TC:IT:extends with super]");
  Serial.print("[TC:EXPECT:toBe:3:");
  Serial.print(__tc_fn4());
  Serial.println("]");
  Serial.println("[TC:DESCRIBE:Static members]");
  Serial.println("[TC:IT:static method]");
  Serial.print("[TC:EXPECT:toBe:14:");
  Serial.print(__tc_fn5());
  Serial.println("]");
  Serial.println("[TC:DESCRIBE:This keyword]");
  Serial.println("[TC:IT:this in method chain]");
  Serial.print("[TC:EXPECT:toBe:10:");
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
  const __tc_fn1__Point* p = new __tc_fn1__Point(3, 4);
  return p->x + p->y;
}

int __tc_fn2()
{
  const __tc_fn2__Calculator* calc = new __tc_fn2__Calculator();
  calc->add(5);
  calc->add(3);
  return calc->value;
}

int __tc_fn3()
{
  const __tc_fn3__Rect* r = new __tc_fn3__Rect(4, 5);
  return r->area();
}

int __tc_fn4()
{
  const __tc_fn4__Dog* d = new __tc_fn4__Dog("Rex", "Shepherd");
  return strlen(d->identify());
}

int __tc_fn5()
{
  return __tc_fn5__MathUtils::double_(7);
}

int __tc_fn6()
{
  const __tc_fn6__Builder* b = new __tc_fn6__Builder();
  b->add(3)->add(7);
  return b->value;
}

void loop()
{
}
