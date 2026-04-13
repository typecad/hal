// Test compile-time peripheral initialization analysis
// This should generate ADC initialization in setup() and optimized analog reads
import { A0, D9, delay, map } from '@typecode';

D9.output(false);

while (true) {
  const sensorValue = A0.readAnalog();  // Should NOT include ADC init check
  const pwmValue = map(sensorValue, 0, 1023, 0, 255);
  D9.write(pwmValue);
  delay(10);
}