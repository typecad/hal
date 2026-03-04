// ---------------------------------------------------------------------------
// demo/src/sketch.ts - BME280 Temperature Reader for Arduino Uno
//
// Reads temperature from BME280 sensor and blinks LED
// ---------------------------------------------------------------------------

import { LED, delay, Serial } from '@typecode';
import { test } from './lib/test';

Serial.initialize({baudRate: 9600})

// Create test instance
const sensor = new test(1);

// Initialize sensor
sensor.begin();
