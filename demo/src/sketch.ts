import { UART0 } from '@typecode';

UART0.config.baudRate(9600).begin();

const temp = 24.5;
const msg = `Temp is ${1 + 2}C`; 

// strips the dynamic allocation and emits safe C++:
// char __voltts_buf_1[16];
// snprintf(__voltts_buf_1, sizeof(__voltts_buf_1), "Temp is %.1fC", temp);

UART0.println(msg);