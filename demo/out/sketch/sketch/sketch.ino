#include <Arduino.h>

volatile unsigned long isr_0_lastTime = 0;
const unsigned long isr_0_debounce = 50;

void isr_0() {
  volatile unsigned long now = millis();
  if (now - isr_0_lastTime < isr_0_debounce) return;
  isr_0_lastTime = now;
  digitalWrite(13, !digitalRead(13));
}

// Auto-generated setup() for top-level statements
void setup()
{
  pinMode(13, OUTPUT);
  pinMode(2, INPUT_PULLUP);
  // Fluent interrupt API with debounce - natural language syntax
  // The mode is implied by the method name, debounce prevents rapid triggers
  attachInterrupt(digitalPinToInterrupt(2), isr_0, FALLING);
  Wire_ping(118);
}

void loop()
{
}
