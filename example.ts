import { LED } from '@typecode';
import { delay } from '@typecode';

LED.asOutput();
console.log('native avr!!!');
while (true) {
  LED.toggle();
  delay(500);
}

