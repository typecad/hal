import { USB0, Time, LED, PA0, ADC, UART0, GPIO } from '@typecad/hal';

const adc = new ADC(PA0);
const led = new GPIO(LED, GPIO.OUTPUT);

USB0.open();
let packet: Owned<Uint8Array> = new Uint8Array(8);
const archived: Shared = packet;   // borrow by reference — 'packet' keeps ownership

UART0.writeLine(String(packet.length));
while (true) {
  USB0.writeLine(`adc: ${adc.readMillivolts()}`);
  USB0.writeLine(`led: ${led.get()}`);

  UART0.writeLine('hi');
  Time.sleep(1000);
}
