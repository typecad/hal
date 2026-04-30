import { D2 } from '@typehal';

const sensor = D2.asInput();

async function monitor() {
    console.log("Waiting for trigger...");
    await sensor.waitForRising();
    console.log("Trigger detected!");
}

monitor();