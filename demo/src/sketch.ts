// ---------------------------------------------------------------------------
// demo/src/sketch.ts - BME280 Temperature Reader for Arduino Uno
//
// Reads temperature from BME280 sensor using Wire-compatible API
// ---------------------------------------------------------------------------

import { I2C0, Serial, LED } from '@typecode';
import { delay } from '@typecode';

// Initialize Serial for debug output
Serial.initialize({ baudRate: 9600 });

// Initialize I2C as master
I2C0.begin();
I2C0.setClock(400000);  // 400kHz Fast Mode

const BME280_ADDR = 0x76;

// Main loop
while (true) {
  // Write register pointer to 0xFA (temperature MSB)
  I2C0.beginTransmission(BME280_ADDR);
  I2C0.write(0xFA);
  const status = I2C0.endTransmission();
  
  if (status === 0) {
    // Request 2 bytes (temperature MSB and LSB)
    I2C0.requestFrom(BME280_ADDR, 2);
    
    // Read the two bytes
    const msb = I2C0.read();
    const lsb = I2C0.read();
    
    // Combine into raw temperature value
    const tempRaw = (msb << 8) | lsb;
    const temperature = tempRaw / 100.0;
    Serial.println(temperature);
  } else {
    Serial.println(`I2C error: ${status}`);
  }
  
  // Blink LED
  LED.toggle();
  delay(1000);
}