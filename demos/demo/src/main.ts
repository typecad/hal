import { D2 } from '@typecad/board-esp32-devkit';

const led = D2.asOutput();

// In setup — nothing needed
// In loop — toggle the LED
led.toggle();
