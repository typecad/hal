
import { I2C0 } from '@typehal/board-arduino-uno';

// Take the bus
const bus = I2C0.take();

// Access without take (on a bus that uses ownership elsewhere)
I2C0.begin(); // OK: begin is allowed

// Double take
const bus2 = I2C0.take();

// Release
I2C0.release();

// Unowned access after release
I2C0.setClock(400000);
