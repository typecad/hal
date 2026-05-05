#include <Arduino.h>

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

namespace SensorLib {

  const auto BASE = 42;
  const auto OFFSET = 8;

} // namespace SensorLib

namespace MathUtils {

  int twice(int x) {
    return x * 2;
  }

} // namespace MathUtils

class __tc_fn3__AddrLib {
public:
  static int read() {
    return 104;
  }

};

class __tc_fn4__I2CBusDev {
public:
  __tc_fn4__I2CBusDev(int addr) {
    this->address = addr;
  }

  int address;

  int getAddress() {
    return this->address;
  }

};

int __tc_fn1();
int __tc_fn2();
int __tc_fn3();
int __tc_fn4();

// Auto-generated setup() for top-level statements
void setup()
{
  Serial.begin(115200);
  Serial.println("[TC:SUITE_START]");
  Serial.println("[TC:DESCRIBE:Namespaced organization]");
  Serial.println("[TC:IT:namespace constant access]");
  Serial.print("[TC:EXPECT:toBe:50:");
  Serial.print(__tc_fn1());
  Serial.println("]");
  Serial.println("[TC:IT:namespace function call]");
  Serial.print("[TC:EXPECT:toBe:10:");
  Serial.print(__tc_fn2());
  Serial.println("]");
  Serial.println("[TC:IT:static class method as library]");
  Serial.print("[TC:EXPECT:toBe:0x68:");
  Serial.print(__tc_fn3());
  Serial.println("]");
  Serial.println("[TC:IT:class instantiation in IIFE]");
  Serial.print("[TC:EXPECT:toBe:0x55:");
  Serial.print(__tc_fn4());
  Serial.println("]");
  Serial.println("[TC:SUITE_END]");
  while (true)
  {
    delay(1000);
  }
}

int __tc_fn1()
{
  return SensorLib::BASE + SensorLib::OFFSET;
}

int __tc_fn2()
{
  return MathUtils::twice(5);
}

int __tc_fn3()
{
  return __tc_fn3__AddrLib::read();
}

int __tc_fn4()
{
  const __tc_fn4__I2CBusDev* bus = new __tc_fn4__I2CBusDev(85);
  return bus->getAddress();
}

void loop()
{
}
