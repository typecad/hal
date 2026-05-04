#include <Arduino.h>

uint8_t buffer[] = { 1, 2, 3 };
// Ownership is transferred to 'movedBuffer'
const uint8_t* movedBuffer = buffer;

// Auto-generated setup() for top-level statements
void setup()
{
  Serial.begin(115200);
  // ERROR: 'buffer' was moved and cannot be used again. [ownership-use-after-move]
  Serial.println(buffer[0]);
}

void loop()
{
}
