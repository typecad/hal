/**
 * Pin Group Example - LED Bar
 * 
 * Demonstrates the createPinGroup function for controlling
 * multiple pins as a group. Useful for LED bars, 7-segment
 * displays, and other multi-pin outputs.
 */

import { D2, D3, D4, D5, D6, D7, D8, D9, delay } from '@typecode';
import { createPinGroup } from '@typecode/core';

// Create a group of 8 pins for an LED bar
const ledBar = createPinGroup('LED Bar', [D2, D3, D4, D5, D6, D7, D8, D9]);

// Initialize all pins as output
for (const pin of ledBar.pins) {
  pin.config.output.initial(false);  // Initialize as output, LOW (off)
}

// Pattern animations
const patterns = {
  // All LEDs on
  allOn: () => ledBar.writeAll([true, true, true, true, true, true, true, true]),
  
  // All LEDs off
  allOff: () => ledBar.writeAll([false, false, false, false, false, false, false, false]),
  
  // Knight Rider style scan
  scan: () => {
    for (let i = 0; i < 8; i++) {
      ledBar.writeAll([
        i === 0, i === 1, i === 2, i === 3,
        i === 4, i === 5, i === 6, i === 7
      ]);
      delay(100);
    }
    for (let i = 7; i >= 0; i--) {
      ledBar.writeAll([
        i === 0, i === 1, i === 2, i === 3,
        i === 4, i === 5, i === 6, i === 7
      ]);
      delay(100);
    }
  },
  
  // Fill up from bottom
  fillUp: () => {
    for (let count = 0; count <= 8; count++) {
      const values = Array(8).fill(false);
      for (let i = 0; i < count; i++) {
        values[i] = true;
      }
      ledBar.writeAll(values);
      delay(200);
    }
  },
};

// Main loop
while (true) {
  patterns.fillUp();
  delay(500);
  patterns.allOff();
  delay(250);
  
  patterns.scan();
  patterns.allOff();
  delay(250);
  
  patterns.allOn();
  delay(1000);
  patterns.allOff();
  delay(500);
}