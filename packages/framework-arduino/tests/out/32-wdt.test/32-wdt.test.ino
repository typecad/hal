#include <Arduino.h>
#include <avr/wdt.h>

#ifndef typehal_halt
#define typehal_halt(msg) do { Serial.println(F(msg)); for (;;) {} } while (0)
#endif

int __tc_fn1();
int __tc_fn2();
int __tc_fn3();

// Auto-generated setup() for top-level statements
void setup()
{
  Serial.begin(115200);
  Serial.println("[TC:SUITE_START]");
  Serial.println("[TC:DESCRIBE:WDT namespace]");
  Serial.println("[TC:IT:WDT.reset() is callable without crashing]");
  Serial.print("[TC:EXPECT:toBe:1:");
  Serial.print(__tc_fn1());
  Serial.println("]");
  Serial.println("[TC:IT:WDT.enable() then WDT.disable() does not trigger reset]");
  Serial.print("[TC:EXPECT:toBe:1:");
  Serial.print(__tc_fn2());
  Serial.println("]");
  Serial.println("[TC:IT:WDT.enable() + WDT.reset() + WDT.disable() full cycle]");
  Serial.print("[TC:EXPECT:toBe:1:");
  Serial.print(__tc_fn3());
  Serial.println("]");
  Serial.println("[TC:SUITE_END]");
  while (true)
  {
    delay(1000);
  }
}

int __tc_fn1()
{
  wdt_reset();
  return 1;
}

int __tc_fn2()
{
  wdt_enable(WDTO_250MS);
  wdt_disable();
  return 1;
}

int __tc_fn3()
{
  wdt_enable(WDTO_500MS);
  wdt_reset();
  wdt_disable();
  return 1;
}

void loop()
{
}
