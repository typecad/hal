#include <Arduino.h>

/**
 * BME280 sensor driver
 */
class BME280 {
public:
  BME280(int address = BME280_ADDRESS) {
  }

  bool begin() {
    return true;
  }

  int readTemperature() {
    return 24.5;
  }

  int readHumidity() {
    // Simplified: returns mock value
    // Full implementation would read from register 0xFD
    return 22.4;
  }

  int readPressure() {
    // Simplified: returns mock value
    // Full implementation would read from registers 0xF7-0xF9
    return 1013.25;
  }

private:
  int address;
  bool initialized = false;

};

void loop()
{
}
