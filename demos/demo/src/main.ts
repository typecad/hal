import { D13 } from '@typecad/board-arduino-uno';

const led = D13.asOutput();

// In setup — nothing needed
// In loop — toggle the LED
led.toggle();