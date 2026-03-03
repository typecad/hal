// Import board-specific pins from the board package
import { LED, delay } from '@typecode/board-arduino-uno';

LED.asOutput();
console.log('native avr!!!');
while (true) {
  LED.toggle();
  delay(500);
}

