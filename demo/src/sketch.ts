import { UART0, D2 } from '@typecode';

UART0.config.baudRate(115200).begin();
UART0.write.line("typeCode fluent API!!!")

// D2.on.change(() => {
//     UART0.write.line("D2 changed!");
// }).debounce(100);
