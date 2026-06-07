// ---------------------------------------------------------------------------
// Example 5f — I2C Slave Mode
//
// Configures the Arduino as an I2C slave device that responds to master
// requests. Shows: begin(address), onReceive(), onRequest().
// ---------------------------------------------------------------------------

import { I2C0 } from '@typecad/framework-arduino/arduino';
import { UART0, LED, delay } from '@typecad';

const serial = UART0.begin(9600);
const SLAVE_ADDR = 0x08;
LED.asOutput(false);
let responseData = new Uint8Array([0x42, 0x43, 0x44, 0x45]);
let responseIndex = 0;
let receivedData: number[] = [];

// Initialize as I2C slave with address 0x08
I2C0.begin(SLAVE_ADDR);

I2C0.onReceive((howMany: number) => {
  serial.println(`Received ${howMany} bytes from master`);

  receivedData = [];
  while (I2C0.available() > 0) {
    const byte = I2C0.read();
    receivedData.push(byte);
    serial.println(`  Got: 0x${byte.toString(16)}`);
  }

  if (receivedData.length > 0) {
    const command = receivedData[0];
    switch (command) {
      case 0x01:
        responseData = new Uint8Array(receivedData.slice(1));
        serial.println("Updated response data");
        break;
      case 0x02:
        LED.toggle();
        break;
    }
  }
});

I2C0.onRequest(() => {
  I2C0.write(responseData[responseIndex]);
  responseIndex = (responseIndex + 1) % responseData.length;
});

serial.println(`I2C Slave ready at address 0x${SLAVE_ADDR.toString(16)}`);
serial.println("Waiting for master requests...");

while (true) {
  delay(1000);
}
