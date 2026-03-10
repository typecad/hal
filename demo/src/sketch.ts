import { LED, HIGH, LOW } from '@typecode';

// Configure LED pin as output, starting HIGH
LED.config.output();

while (true) {
  LED.toggle();  // Switch between HIGH and LOW
  // Or use: LED.high(), LED.low()
}