// Test compile-time peripheral initialization analysis
// This should generate ADC initialization in setup() and optimized analog reads
import { A0, D9 } from '@typecode/board-native-atmega328p';
import { delay, map } from '@typecode/board-native-atmega328p';

D9.asOutput();

while (true) {
  const sensorValue = A0.read();  // Should NOT include ADC init check
  const pwmValue = map(sensorValue, 0, 1023, 0, 255);
  D9.write(pwmValue);
  delay(10);
}
