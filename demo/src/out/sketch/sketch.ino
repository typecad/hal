#include <Arduino.h>

// Auto-generated setup() for top-level statements
void setup()
{
  pinMode(13, OUTPUT);
  while (true)
  {
    digitalWrite(13, !digitalRead(13));
  }
}

void loop()
{
}
