// ---------------------------------------------------------------------------
// Example 5f — I2C Slave Mode
//
// Configures the Arduino as an I2C slave device that responds to master
// requests. Shows: begin(address), onReceive(), onRequest()
// ---------------------------------------------------------------------------

import { I2C0, UART0 } from '@typecode/board-arduino-uno/arduino';
import { LED }          from '@typecode/board-arduino-uno';

const serial = UART0.begin(9600);

// Slave address (must be unique on bus)
const SLAVE_ADDR = 0x08;

// Data buffer for slave responses
let responseData = new Uint8Array([0x42, 0x43, 0x44, 0x45]);
let responseIndex = 0;

// Received data buffer
let receivedData: number[] = [];

// Initialize as I2C slave with address 0x08
I2C0.begin(SLAVE_ADDR);

// Register callbacks for slave mode
I2C0.onReceive((howMany: number) => {
  serial.println(`Received ${howMany} bytes from master`);
  
  // Read all received bytes
  receivedData = [];
  while (I2C0.available() > 0) {
    const byte = I2C0.read();
    receivedData.push(byte);
    serial.println(`  Got: 0x${byte.toString(16)}`);
  }
  
  // First byte is typically a command/register
  if (receivedData.length > 0) {
    const command = receivedData[0];
    switch (command) {
      case 0x01:  // Set response data
        responseData = new Uint8Array(receivedData.slice(1));
        serial.println("Updated response data");
        break;
      case 0x02:  // Toggle LED
        LED.toggle();
        break;
    }
  }
});

I2C0.onRequest(() => {
  // Master is requesting data - send response
  I2C0.write(responseData[responseIndex]);
  responseIndex = (responseIndex + 1) % responseData.length;
  
  // Alternative: Send multiple bytes
  // I2C0.write(responseData);
});

serial.println(`I2C Slave ready at address 0x${SLAVE_ADDR.toString(16)}`);
serial.println("Waiting for master requests...");

// Main loop - slave callbacks handle I2C communication
while (true) {
  // Can do other work here
  // I2C callbacks are interrupt-driven
}
