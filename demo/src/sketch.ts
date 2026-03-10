import { LED, I2C0, A4 } from '@typecode';

// Configure LED pin as output, starting HIGH
LED.config.output();

A4.config.input.float();

while (true) {
  LED.toggle();  // Switch between HIGH and LOW
  
  // Or use: LED.high(), LED.low()
}
