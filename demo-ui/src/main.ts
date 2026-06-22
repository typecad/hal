// ---------------------------------------------------------------------------
// main.ts — TypeHAL UI demo (flexbox + touch input)
//
// Touch: tap button to increment, tap checkbox to toggle, tap mode to cycle.
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

// Counter
screen.counter.value = 0;
ui.bind(screen.counter, 'color', () => (screen.counter.value % 2 === 0 ? 'limegreen' : 'orange'));
ui.bind(screen.counter, 'text', () => String(screen.counter.value));

// Button: momentary press (value=1 on touch, 0 on release)
ui.bind(screen.btn, 'background', () => (screen.btn.value > 0 ? 'limegreen' : 'darkgreen'));
screen.btn.onClick(() => {
  screen.counter.value = screen.counter.value + 1;
});

// Checkbox: toggle (tap to check/uncheck, value persists)
screen.ledBox.value = 0;
screen.ledBox.onClick(() => {
  screen.ledBox.value = screen.ledBox.value > 0 ? 0 : 1;
});
ui.bind(screen.ledBox, 'background', () => (screen.ledBox.value > 0 ? 'limegreen' : 'transparent'));
ui.bind(screen.ledBox, 'borderColor', () => (screen.ledBox.value > 0 ? 'limegreen' : '#808080'));

// Mode selector: cycle through options on tap
screen.modeValue.value = 0;
screen.modeValue.onClick(() => {
  screen.modeValue.value = (screen.modeValue.value + 1) % 3;
});
ui.bind(screen.modeValue, 'text', () => (
  screen.modeValue.value === 0 ? 'Auto' : screen.modeValue.value === 1 ? 'Manual' : 'Off'
));
ui.bind(screen.modeValue, 'color', () => (screen.modeValue.value === 0 ? 'limegreen' : 'khaki'));

// Auto-increment every 3 seconds
setInterval(() => {
  screen.counter.value = screen.counter.value + 1;
}, 3000);
