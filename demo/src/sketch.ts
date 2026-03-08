import { UART0, D2, I2C0 } from '@typecode';
// import { BH1750 } from './lib/BH1750';
// import { SHT3x } from 'Microfire_SHT3x'

UART0.config.baudRate(115200).begin();
UART0.write.line("typeCode fluent")
// let lux = new BH1750(0x23);
// let sht30 = new SHT3x();

D2.config.input.float();
// lux.begin(0x20, 0x33, 0);
// SHT3x temperature/humidity sensor
// Uses I2C bus - TypeCode maps TwoWire to I2C automatically
// sht30.begin(I2C0, 0x44);

// Read sensor data
// sht30.measure();

// D2.on.change(() => {
//     UART0.write.line("D2 changed!");
// }).debounce(100);