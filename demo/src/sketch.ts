// ---------------------------------------------------------------------------
// demo/src/sketch.ts - BME280 Temperature Reader for Arduino Uno
//
// Reads temperature from BME280 sensor and blinks LED
// ---------------------------------------------------------------------------

import { LED, delay, Serial } from '@typecode';
import { BME280 } from './lib/bme280';
import { test } from './lib/test';
// Create BME280 instance
const sensor = new BME280();
const tester = new test();

// Configure LED pin as output
LED.asOutput();;

// Initialize sensor
sensor.begin();

// Main loop
while (true) {
  // Read temperature
  const temp = sensor.readTemperature();
  
  // Print to serial
  Serial.print('Temperature: ');
  Serial.print(temp);
  Serial.println(' C');
  
  // Blink LED
  LED.toggle();
  delay(1000);
}