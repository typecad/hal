import { HIGH, LED, delay } from '@typehal';
const led = LED.asOutput(HIGH);

led.pulse(50);