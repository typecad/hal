#include <Arduino.h>

const int BME280_ADDR = 118;

// Auto-generated setup() for top-level statements
void setup()
{
  // Initialize Serial for debug output
  Serial.begin(9600);
  // Initialize I2C as master
  Wire.begin();
  Wire.setClock(400000);
  // 400kHz Fast Mode
  // Main loop
  while (true)
  {
    // Write register pointer to 0xFA (temperature MSB)
    Wire.beginTransmission(BME280_ADDR);
    Wire.write(250);
    const int status = Wire.endTransmission(true);
    if (status == 0)
    {
      // Request 2 bytes (temperature MSB and LSB)
      Wire.requestFrom(BME280_ADDR, 2);
      // Read the two bytes
      const int msb = Wire.read();
      const int lsb = Wire.read();
      // Combine into raw temperature value
      const int tempRaw = msb << 8 | lsb;
      const int temperature = tempRaw / 100;
      Serial.println(temperature);
    }
    else {
      Serial.println("I2C error: " + String(String(status)));
    }
    // Blink LED
    digitalWrite(13, !digitalRead(13));
    delay(1000);
  }
}

void loop()
{
}
