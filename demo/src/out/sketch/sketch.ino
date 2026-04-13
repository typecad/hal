#include <Arduino.h>

// Auto-generated setup() for top-level statements
void setup()
{
  // ── I2C with ownership ─────────────────────────────────────────────────────
  // take() claims exclusive access; returns undefined if already owned.
  // The returned IOwnedI2CBus has the full II2CBus API plus release().
  /* I2C0.take() */;
  if (i2c)
  {
    Wire.beginTransmission(118); Wire.write(250); Wire.write(85); Wire.endTransmission();
    /* I2C0.release() */;
  }
}

void loop()
{
}
