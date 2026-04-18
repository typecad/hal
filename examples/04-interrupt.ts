import { D2, LED } from '@typecode';

const led = LED.asOutput(false);
let ledState = false;

D2.onChange(() => {
  ledState = !ledState;
  if (ledState) {
    led.high();
  } else {
    led.low();
  }
});