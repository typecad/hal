/**
 * Pin Validation Example
 * 
 * Demonstrates compile-time and runtime pin validation utilities:
 * - Type guards: isPWMPin(), isAnalogPin(), isInterruptPin()
 * - Assertion functions: assertPWM(), assertAnalog()
 * 
 * These utilities help write safer code that checks pin capabilities
 * before using features that require specific capabilities.
 */

import { D2, D3, A0, LED, delay, UART0 } from '@typecode';
import type { IPin, IPWMPin } from '@typecode/core';
import { 
  isPWMPin, 
  isAnalogPin, 
  isInterruptPin,
  assertPWM 
} from '@typecode/core';

// Initialize serial for output
UART0.config.baudRate(9600).begin();

// Example 1: Using type guards for runtime checks
function safeAnalogWrite(pin: unknown, value: number) {
  // Type guard narrows type to IPWMPin
  if (isPWMPin(pin)) {
    // Convert 0-255 to percentage
    const percent = (value / 255) * 100;
    pin.pwm(percent);
    UART0.println("PWM write successful");
  } else {
    UART0.println("Pin does not support PWM!");
  }
}

// Example 2: Using assertion functions
void function() {
  UART0.println("Testing pin capabilities...");
  
  // D3 is a PWM pin - this passes
  assertPWM(D3, 'D3 must support PWM');
  UART0.println("D3 supports PWM");
  
  // Check analog capability with type guard
  if (isAnalogPin(A0)) {
    const value = A0.read();
    UART0.print("A0 analog value: ");
    UART0.println(value);
  }
  
  // Check interrupt capability
  if (isInterruptPin(D2)) {
    UART0.println("D2 supports interrupts");
  }
};

// Example 3: Fade LED with compile-time validation
// This function only accepts PWM-capable pins
function fadeLED(pin: IPin & IPWMPin) {
  for (let i = 0; i <= 100; i++) {
    pin.pwm(i);
    delay(5);
  }
  for (let i = 100; i >= 0; i--) {
    pin.pwm(i);
    delay(5);
  }
}

// Main program
LED.config.output.initial(false);
D3.config.pwm.initial(0);

UART0.println("Starting main loop...");

while (true) {
  // Fade the LED on D3 (PWM capable)
  // D3 is typed as PWM pin, so this compiles
  fadeLED(D3);
  
  // Read and display analog value
  if (isAnalogPin(A0)) {
    const reading = A0.read();
    UART0.print("Sensor reading: ");
    UART0.println(reading);
  }
  
  delay(100);
}