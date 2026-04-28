// ---------------------------------------------------------------------------
// Native Serial/UART Example
//
// Demonstrates native UART communication on ATmega328P using direct register
// access instead of the Arduino Serial library.
// ---------------------------------------------------------------------------

import { UART0, A0, delay } from '@typehal';

// Initialize UART0 at 9600 baud
const serial = UART0.begin(9600);

// Print startup message
serial.println("Native UART Demo");
serial.println("=================");

// Configure A0 as analog input (analog reads work without explicit config)

let counter = 0;

while (true) {
  // Read analog value
  const sensorValue = A0.readAnalog();
  
  // Print counter and sensor value
  serial.print("Count: ");
  serial.println(counter);
  serial.print("ADC: ");
  serial.println(sensorValue);
  
  // Also demonstrate console.log (maps to Serial.println)
  console.log("Loop iteration complete");
  
  counter++;
  delay(1000);
}
