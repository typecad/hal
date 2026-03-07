import { UART0, D2 } from '@typecode';
import { BH1750 } from './lib/BH1750';

UART0.config.baudRate(115200).begin();
UART0.write.line("typeCode fluent")
let lux = new BH1750(0x23);

D2.config.input.float();
lux.begin(0x20, 0x33, 0);
// D2.on.change(() => {
//     UART0.write.line("D2 changed!");
// }).debounce(100);