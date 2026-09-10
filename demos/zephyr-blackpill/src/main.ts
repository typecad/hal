import { USB0, Time, LED, PA0, ADC, UART0 } from '@typecad/hal';

const adc = new ADC(PA0)
USB0.open();

while (true) {
  USB0.writeLine(`adc: ${adc.readMillivolts()}`)
  UART0.writeLine('hi');
  Time.sleep(1000);
}

