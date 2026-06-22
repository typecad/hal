// ---------------------------------------------------------------------------
// main.ts — TypeHAL UI demo (flexbox + touch input)
//
// Touch: tap the button to increment the counter.
// Auto-increments every 3 seconds via timer.
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

// Counter state + display bindings
screen.counter.value = 0;
ui.bind(screen.counter, 'color', () => (screen.counter.value % 2 === 0 ? 'limegreen' : 'orange'));
ui.bind(screen.counter, 'text', () => String(screen.counter.value));

// Button background driven by its pressed .value
ui.bind(screen.btn, 'background', () => (screen.btn.value > 0 ? 'limegreen' : 'darkgreen'));

// Touch: button responds to tap
screen.btn.onClick(() => {
  console.log("button tapped");
  screen.counter.value = screen.counter.value + 1;
});

// Auto-increment every 3 seconds
setInterval(() => {
  screen.counter.value = screen.counter.value + 1;
}, 3000);

