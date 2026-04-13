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

// Initialize all pins as output, LOW (off)
ledBar.fill(false);

// Pattern animations
const patterns = {
  // All LEDs on
  allOn: () => ledBar.writePattern(0xFF),

  // All LEDs off
  allOff: () => ledBar.writePattern(0x00),

  // Knight Rider style scan
  scan: () => {
    for (let i = 0; i < 8; i++) {
      ledBar.writePattern(1 << i);
      delay(100);
    }
    for (let i = 6; i > 0; i--) {
      ledBar.writePattern(1 << i);
      delay(100);
    }
  },

  // Fill up from bottom
  fillUp: () => {
    for (let count = 0; count <= 8; count++) {
      ledBar.writePattern((1 << count) - 1);
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
