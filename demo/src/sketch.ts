import { D2, LED, millis } from '@typecode';
import { Button } from './Button';

// ── Usage ─────────────────────────────────────────────────────────────────

const led = LED.asOutput(false);

const btn = Button.start(D2, 50).onPress(() => {
  led.toggle();
});