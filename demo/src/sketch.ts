import { Shift, D2, D3 } from '@typehal';

const dataPin = D2.asOutput();
const clockPin = D3.asOutput();

// Send the value 0b10101010, Most Significant Bit first
Shift.out(dataPin, clockPin, 'msb', 0xAA);

// Fluent style
Shift.write(dataPin, 0xAA).clock(clockPin).msbFirst();