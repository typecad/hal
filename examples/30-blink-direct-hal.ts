import { LED, HIGH, delay } from './hal/boards/arduino-uno';

const led = LED.asOutput(HIGH);

while (true) {
  led.toggle();
  delay(1000);
}
