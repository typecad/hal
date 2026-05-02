#include <Arduino.h>
#include <Wire.h>

const int BME280_ADDR = 118;

// Auto-generated setup() for top-level statements
void setup()
{
  // Initialize UART0 for debug output
  Serial.begin(9600);
  // Initialize I2C as master
  Wire.begin();
  // Main loop
  while (true)
  {
    // Read 2 bytes from register 0xFA (temperature data)
    uint8_t tempData[2];
    Wire.beginTransmission(BME280_ADDR);
    Wire.write(250);
    Wire.endTransmission(false);
    Wire.requestFrom(BME280_ADDR, 2);
    for (int i = 0; i < 2; i++) { tempData[i] = Wire.read(); }
    
    // Access bytes directly from returned Uint8Array
    const auto msb = tempData[0];
    const auto lsb = tempData[1];
    // Combine into raw temperature value
    const auto tempRaw = (msb << 8) | lsb;
    const auto temperature = tempRaw / 100.0f;
    Serial.println(temperature);
    delay(1000);
  }
}

void loop()
{
}
