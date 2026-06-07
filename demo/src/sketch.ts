import { UART0 } from '@typecad';

const uart = UART0.begin(115200);
const test = "typeHAL";
uart.println(`${test} is working ${1+2}`);