// Import board-specific pins from the board package
import { LED, delay } from '@typecode';

const square = (x: number) => x * x;

let counter = 0;

LED.asOutput();
while (true) {
  counter++;
  LED.toggle();
  delay(500);
  digitalRead(X0);
}
