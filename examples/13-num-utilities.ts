// ---------------------------------------------------------------------------
// Number utilities (map, clamp, min, max, abs)
//
// Demonstrates both direct and fluent chainable APIs.
// ---------------------------------------------------------------------------

import { A0, D3, D13, Num, delay } from '@typecad';

// ---------------------------------------------------------------------------
// Direct function calls
// ---------------------------------------------------------------------------

// Read analog value and map to PWM range
const sensorValue = A0.readAnalog();
const pwmValue = Num(sensorValue, 0, 1023, 0, 255);

// Clamp a value to valid PWM range
const safePwm = Num.clamp(pwmValue, 0, 255);

// Get absolute value
const absolute = Num.abs(-42);

// Min/max
const smallest = Num.min(3, 7);
const largest = Num.max(3, 7);

// Convenience helpers
const percent = Num.toPercent(sensorValue, 0, 1023);
const byteVal = Num.toByte(percent, 0, 100);

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

// Fluent clamp
const safe = Num.clamp(pwmValue)
  .between(0, 255);

// ---------------------------------------------------------------------------
// Arduino setup/loop
// ---------------------------------------------------------------------------

export function setup() {
  D13.asOutput(false);
}

export function loop() {
  // Read sensor and map to PWM
  const raw = A0.readAnalog();

  // Using direct map
  const pwm1 = Num(raw, 0, 1023, 0, 255);

  // Using fluent API
  const pwm2 = Num.map(raw).from(0, 1023).to(0, 255);

  // Apply to PWM pin
  D3.pwm(pwm2 / 2.55);

  // Blink LED
  D13.high();
  delay(100);
  D13.low();
  delay(100);
}
