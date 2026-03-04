 /** BME280 I2C address (default when SDO pin is grounded) */
  const int BME280_ADDRESS = 118;
  /** BME280 register addresses */
  const int REG_CTRL_MEAS = 244;
  const int REG_CTRL_HUM = 242;
  const int REG_CONFIG = 245;
  const int REG_TEMP_MSB = 250;
  const int REG_CALIB_00 = 136;
  /** Calibration data storage */
  int dig_T1;
  int dig_T2;
  int dig_T3;
  int t_fine = 0;

  /**
   * BME280 sensor driver
   */
  class test {
  public:
    test(int address = BME280_ADDRESS) {
    }

    bool begin() {
      Serial.println("hello from cpp class");
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

