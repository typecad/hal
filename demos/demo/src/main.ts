import { GPIO13 } from '@typecad/board';
import { delay } from '@typecad/hal';

const led = GPIO13.asOutput();
let cnt = 0;

setInterval(() => {
  led.toggle();
  cnt++;
}, 500)