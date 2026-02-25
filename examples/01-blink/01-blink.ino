#include <Arduino.h>
#include <Pins.h>
#include <Timing.h>

// Auto-generated setup() for top-level statements
void setup()
{
  pinMode(LED_BUILTIN, OUTPUT);
  while (true)
  {
    digitalWrite(LED_BUILTIN, !digitalRead(LED_BUILTIN));
    delay(1000);
  }
}

void loop()
{
}
