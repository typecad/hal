// ---------------------------------------------------------------------------
// Native Serial/UART Example
//
// Demonstrates native UART communication on ATmega328P using direct register
// access instead of the Arduino Serial library.
// ---------------------------------------------------------------------------

import { Serial, A0, delay } from '@typecode/board-native-atmega328p';

// Initialize Serial at 9600 baud
Serial.initialize({ baudRate: 9600 });

// Print startup message
Serial.println("Native UART Demo");
Serial.println("================");

// Configure A0 as analog input
A0.config.analog();

let counter = 0;

while (true) {
  // Read analog value
  const sensorValue = A0.read();
  
  // Print counter and sensor value
  Serial.print("Count: ");
  Serial.println(counter);
  Serial.print("ADC: ");
  Serial.println(sensorValue);
  
  // Also demonstrate console.log (maps to Serial.println)
  console.log("Loop iteration complete");
  
  counter++;
  delay(1000);
}