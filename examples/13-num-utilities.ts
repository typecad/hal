// ---------------------------------------------------------------------------
// Example: Number utilities (map, constrain, min, max, abs)
//
// Demonstrates both direct (Arduino-compatible) and fluent chainable APIs.
// ---------------------------------------------------------------------------

import { A0, D3, D13, Num, map, constrain, abs, min, max, toPercent, toByte } from '@typecode/board-arduino-uno';

// ---------------------------------------------------------------------------
// Direct function calls (Arduino-compatible)
// ---------------------------------------------------------------------------

// Read analog value and map to PWM range
const sensorValue = A0.read();
const pwmValue = map(sensorValue, 0, 1023, 0, 255);

// Constrain a value to valid PWM range
const safePwm = constrain(pwmValue, 0, 255);

// Get absolute value
const absolute = abs(-42);

// Min/max
const smallest = min(3, 7);
const largest = max(3, 7);

// Convenience helpers
const percent = toPercent(sensorValue, 0, 1023);
const byte = toByte(percent, 0, 100);

// ---------------------------------------------------------------------------
// Fluent chainable API
// ---------------------------------------------------------------------------

// Fluent map with explicit ranges
const mapped = Num.map(sensorValue)
  .from(0, 1023)
  .to(0, 255);

// Fluent map to percent
const pct = Num.map(sensorValue)
  .from(0, 1023)
  .toPercent();

// Fluent map to byte
const b = Num.map(sensorValue)
  .from(0, 1023)
  .toByte();

// Fluent constrain
const safe = Num.constrain(pwmValue)
  .between(0, 255);

// ---------------------------------------------------------------------------
// Arduino setup/loop
// ---------------------------------------------------------------------------

export function setup() {
  D13.asOutput();
}

export function loop() {
  // Read sensor and map to PWM
  const raw = A0.read();
  
  // Using direct map
  const pwm1 = map(raw, 0, 1023, 0, 255);
  
  // Using fluent API
  const pwm2 = Num.map(raw).from(0, 1023).to(0, 255);
  
  // Apply to PWM pin
  D3.write(pwm1);
  
  // Blink LED
  D13.high();
  delay(100);
  D13.low();
  delay(100);
}