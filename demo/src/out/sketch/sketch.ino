#include <Arduino.h>
#include <stdio.h>
#include <stdlib.h>

const float temp = 24.5;

// Auto-generated setup() for top-level statements
void setup()
{
  Serial.begin(9600);
  char msg[22];
  snprintf(msg, sizeof(msg), "Temp is %dC", 1 + 2);
  Serial.println(msg);
}

void loop()
{
}
