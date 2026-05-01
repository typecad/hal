#include <Arduino.h>

int percent = 0;
int direction = 1;

// Auto-generated setup() for top-level statements
void setup()
{
  pinMode(9, OUTPUT);
  while (true)
  {
    pinMode(9, OUTPUT); analogWrite(9, (int)((percent) * 255 / 100));
    percent += direction;
    if (percent <= 0 || percent >= 100)
    {
      direction *= -1;
    }
    delay(20);
  }
}

void loop()
{
}
