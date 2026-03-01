// Test file for native ATmega328P transpilation
// This should generate direct AVR register access, not Arduino calls

import { D13, D2, A0, D9 } from '@typecode/board-native-atmega328p';

// Setup function
export function setup(): void {
  // Configure pins
  D13.asOutput();    // LED pin
  D9.asOutput();     // PWM pin
  D2.asInput();      // Digital input
}

// Loop function
export function loop(): void {
  // Digital operations - should generate direct PORT register access
  D13.high();        // Should be: PORTB |= (1 << 5)
  D13.low();         // Should be: PORTB &= ~(1 << 5)
  D13.toggle();      // Should be: PORTB ^= (1 << 5)
  
  // Read digital state
  const state = D2.read();  // Should be: ((PIND >> 2) & 1)
  
  // Analog read - should generate ADC register operations
  const analogValue = A0.read();  // Should be inline ADC code
  
  // PWM write - should generate timer register operations
  D9.write(128);      // Should configure Timer1 and set OCR1A
  
  // Use variables to prevent unused warnings
  if (state && analogValue > 512) {
    D13.high();
  }
}
