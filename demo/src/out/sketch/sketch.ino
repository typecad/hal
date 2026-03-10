#include <Arduino.h>

// Auto-generated setup() for top-level statements
void setup()
{
  pinMode(13, OUTPUT);
  Wire.begin();
  pinMode(A4, INPUT);
  while (true)
  {
    digitalWrite(13, !digitalRead(13));
  }
}

void loop()
{
}
