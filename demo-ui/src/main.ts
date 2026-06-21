// ---------------------------------------------------------------------------
// main.ts — TypeHAL UI demo (flexbox + bidirectional .value)
//
// Exercises flexbox layout, .value reads/writes, reactive bindings, pin input,
// and the transition engine.
//
// GPIO4: increments counter   GPIO5: toggles checkbox
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

// Counter: .value is the source of truth. Bindings compute display from it.
screen.counter.value = 0;

// Counter color: limegreen when even, orange when odd
ui.bind(screen.counter, 'color', () => (screen.counter.value % 2 === 0 ? 'limegreen' : 'orange'));

// Counter text: reflect the value as a string
ui.bind(screen.counter, 'text', () => String(screen.counter.value));

// Button: .value drives the pressed color transition
ui.bind(screen.btn, 'background', () => (screen.btn.value > 0 ? 'limegreen' : 'darkgreen'));

// GPIO4: increment the counter
ui.watchPin(4, () => { screen.counter.value = screen.counter.value + 1; });

// GPIO5: toggle the checkbox (auto-flips .value, no callback needed)
screen.led.onToggle(5);

// Auto-increment every 2 seconds so the counter visibly changes
setInterval(() => {
  screen.counter.value = screen.counter.value + 1;
}, 2000);
