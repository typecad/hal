import { USB0, Time, LED, PA0, ADC, UART0, GPIO, I2C0 } from '@typecad/hal';

const adc = new ADC(PA0);
const led = new GPIO(LED, GPIO.OUTPUT);

USB0.open();

while (true) {
  USB0.writeLine(`adc: ${adc.readMillivolts()}`);
  USB0.writeLine(`led: ${led.get()}`);

  UART0.writeLine('hi');
  Time.sleep(1000);
}
