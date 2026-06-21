// ---------------------------------------------------------------------------
// main.ts — TypeHAL UI demo (flexbox layout showcase)
//
// A status display with a header row, a centered counter + animated button,
// and a footer hint. Exercises flexbox, flex-grow, gap, align-items,
// justify-content, border-bottom, named colors, text-align, border-radius,
// and the transition + binding engine.
//
// Press GPIO4 to trigger the button's color transition.
// The counter increments every 2 seconds, changing color on even/odd.
// ---------------------------------------------------------------------------

import { ui } from '@typecad/ui';
import { screen } from './hello.ui.html';
import { Adafruit_ILI9341 } from '../lib/Adafruit_ILI9341/Adafruit_ILI9341';

ui.mount(screen, {
  display: 'ili9341',
  bus: 'SPI',
  cs: 5,
  dc: 21,
  rst: 22,
});

// Reactive state
const pressed = ui.signal(0);
const count = ui.signal(0);

// Button background transitions between dark green and lime on press
ui.bind(screen.btn, 'background', () => (pressed() > 0 ? 'limegreen' : 'darkgreen'));

// Counter color: limegreen when even, orange when odd
ui.bind(screen.counter, 'color', () => (count() % 2 === 0 ? 'limegreen' : 'orange'));

// Press wiring: GPIO4
screen.btn.onPress(4);
screen.btn.onRelease(4);

// Auto-increment the counter every 2 seconds so the color visibly changes
setInterval(() => {
  count.set(count() + 1);
}, 2000);
