import { USB0, Time, LED, PA0, ADC } from '@typecad/board';

const adc = new ADC(PA0)
USB0.open();

while (true) {
  USB0.writeLine(`adc: ${adc.readMillivolts()}`)

  Time.sleep(1000);
}

