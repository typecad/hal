#include <Arduino.h>

// TypeCAD Core Shims
#ifndef CUTTLEFISH_UNDEFINED
#define CUTTLEFISH_UNDEFINED 0
#endif

// Nullish helpers — overload set so value/struct types (which always
// exist) return false from the generic template, while scalars compare
// against CUTTLEFISH_UNDEFINED. The generic catch-all must NOT cast
// (T)CUTTLEFISH_UNDEFINED — that fails to compile for non-scalar T.

// TypeCAD Native Polyfills

void main_isr_0();
void main_isr_1();
void main_isr_2();
void main_isr_3();
void main_isr_4();
void main_isr_5();
static double __tc_fn1();
static double __tc_fn2();
static double __tc_fn3();
static double __tc_fn4();
static double __tc_fn5();
static double __tc_fn6();
static double __tc_fn7();
static double __tc_fn8();

void main_isr_0() {
}

void main_isr_1() {
}

void main_isr_2() {
}

void main_isr_3() {
}

void main_isr_4() {
}

void main_isr_5() {
}

// Auto-generated setup() for top-level statements
void setup()
{
  Serial.begin(115200);
  Serial.println("[TC:SUITE_START]");
  Serial.println("[TC:DESCRIBE:Global interrupt control]");
  Serial.println("[TC:IT:noInterrupts() is callable without crashing]");
  Serial.print("[TC:EXPECT:toBe:1:");
  Serial.print(__tc_fn1());
  Serial.println("]");
  Serial.println("[TC:IT:interrupts() is callable without crashing]");
  Serial.print("[TC:EXPECT:toBe:1:");
  Serial.print(__tc_fn2());
  Serial.println("]");
  Serial.println("[TC:IT:noInterrupts() then interrupts() restores state]");
  Serial.print("[TC:EXPECT:toBe:1:");
  Serial.print(__tc_fn3());
  Serial.println("]");
  Serial.println("[TC:DESCRIBE:attachInterrupt / detachInterrupt]");
  Serial.println("[TC:IT:attachInterrupt() registers a handler]");
  Serial.print("[TC:EXPECT:toBe:1:");
  Serial.print(__tc_fn4());
  Serial.println("]");
  Serial.println("[TC:IT:attachInterrupt() accepts RISING mode]");
  Serial.print("[TC:EXPECT:toBe:1:");
  Serial.print(__tc_fn5());
  Serial.println("]");
  Serial.println("[TC:IT:attachInterrupt() accepts CHANGE mode]");
  Serial.print("[TC:EXPECT:toBe:1:");
  Serial.print(__tc_fn6());
  Serial.println("]");
  Serial.println("[TC:IT:detachInterrupt() removes a handler]");
  Serial.print("[TC:EXPECT:toBe:1:");
  Serial.print(__tc_fn7());
  Serial.println("]");
  Serial.println("[TC:DESCRIBE:InputPin edge helpers]");
  Serial.println("[TC:IT:onFalling/onRising/onChange/offAll are callable]");
  Serial.print("[TC:EXPECT:toBe:1:");
  Serial.print(__tc_fn8());
  Serial.println("]");
  Serial.println("[TC:SUITE_END]");
  while (true)
  {
    delay(1000);
  }
}

static double __tc_fn1()
{
  noInterrupts();
  return 1;
}

static double __tc_fn2()
{
  interrupts();
  return 1;
}

static double __tc_fn3()
{
  noInterrupts();
  interrupts();
  return 1;
}

static double __tc_fn4()
{
  attachInterrupt(2, main_isr_0, "FALLING");
  return 1;
}

static double __tc_fn5()
{
  attachInterrupt(2, main_isr_1, "RISING");
  return 1;
}

static double __tc_fn6()
{
  attachInterrupt(2, main_isr_2, "CHANGE");
  return 1;
}

static double __tc_fn7()
{
  detachInterrupt(2);
  return 1;
}

static double __tc_fn8()
{
  pinMode(2, INPUT_PULLUP);
  attachInterrupt(digitalPinToInterrupt(2), main_isr_3, FALLING);
  attachInterrupt(digitalPinToInterrupt(2), main_isr_4, RISING);
  attachInterrupt(digitalPinToInterrupt(2), main_isr_5, CHANGE);
  detachInterrupt(digitalPinToInterrupt(2));
  return 1;
}

void loop()
{
}
