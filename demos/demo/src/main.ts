import { D2 } from '@typecad/board-esp32s3';
import { delay } from '@typecad/hal';

const led = D2.asOutput();

while(1) {
  led.toggle();
  delay(500);
  console.log('toggle');
}
