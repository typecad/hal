#include <Arduino.h>

void demo();

// Auto-generated setup() for top-level statements
void setup()
{
  Serial.begin(115200);
  demo();
}

void demo()
{
  int a[] = { 1, 2, 3 };
  std::vector<int> b = a;
  // move
  Serial.println(a[0]);
  // use-after-move
}

void loop()
{
}
