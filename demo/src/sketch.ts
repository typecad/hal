import { HIGH, LED, delay } from '@typehal';

// Recommended pattern: alias-based GPIO usage.
const led = LED.asOutput(HIGH);

async function blink() {
    while (true) {
        led.toggle();
        await delay(1000);
    }
}

blink();