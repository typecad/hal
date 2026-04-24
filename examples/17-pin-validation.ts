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
import { isPWMPin, isAnalogPin, isInterruptPin, assertPWM } from '@typecode/core';
import type { PWMPin } from '@typecode/core';

// Initialize serial for output
const serial = UART0.begin(9600);

// Example 1: Using type guards for runtime checks
function safeAnalogWrite(pin: unknown, value: number) {
  // Type guard narrows type to PWMPin
  if (isPWMPin(pin)) {
    // Convert 0-255 to percentage
    const percent = (value / 255) * 100;
    pin.pwm(percent);
    serial.println("PWM write successful");
  } else {
    serial.println("Pin does not support PWM!");
  }
}

// Example 2: Using assertion functions
void function() {
  serial.println("Testing pin capabilities...");
  
  // D3 is a PWM pin - this passes
  assertPWM(D3, 'D3 must support PWM');
  serial.println("D3 supports PWM");
  
  // Check analog capability with type guard
  if (isAnalogPin(A0)) {
    const value = A0.readAnalog();
    serial.print("A0 analog value: ");
    serial.println(value);
  }
  
  // Check interrupt capability
  if (isInterruptPin(D2)) {
    serial.println("D2 supports interrupts");
  }
};

// Example 3: Fade LED with compile-time validation
// This function only accepts PWM-capable pins
function fadeLED(pin: PWMPin) {
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
LED.asOutput(false);
D3.pwm(0);

serial.println("Starting main loop...");

while (true) {
  // Fade the LED on D3 (PWM capable)
  // D3 is typed as PWM pin, so this compiles
  fadeLED(D3);
  
  // Read and display analog value
  if (isAnalogPin(A0)) {
    const reading = A0.readAnalog();
    serial.print("Sensor reading: ");
    serial.println(reading);
  }
  
  delay(100);
}
