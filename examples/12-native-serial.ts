// ---------------------------------------------------------------------------
// Native Serial/UART Example
//
// Demonstrates native UART communication on ATmega328P using direct register
// access instead of the Arduino Serial library.
// ---------------------------------------------------------------------------

import { UART0, A0, delay } from '@typecode';

// Initialize UART0 at 9600 baud
UART0.config.baudRate(9600).begin();

// Print startup message
UART0.println("Native UART Demo");
UART0.println("=================");

// Configure A0 as analog input
A0.config.analog();

let counter = 0;

while (true) {
  // Read analog value
  const sensorValue = A0.read();
  
  // Print counter and sensor value
  UART0.print("Count: ");
  UART0.println(counter);
  UART0.print("ADC: ");
  UART0.println(sensorValue);
  
  // Also demonstrate console.log (maps to Serial.println)
  console.log("Loop iteration complete");
  
  counter++;
  delay(1000);
}
