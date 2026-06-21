// ---------------------------------------------------------------------------
// main.ts — TypeHAL UI demo (flexbox + composed checkbox + select)
//
// GPIO4: increments counter   GPIO5: toggles checkbox   GPIO15: cycles mode
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

// ── Composed checkbox ──────────────────────────────────────────────────────
ui.bind(screen.ledBox, 'background', () => (screen.ledBox.value ? 'limegreen' : 'transparent'));
ui.bind(screen.ledBox, 'borderColor', () => (screen.ledBox.value ? 'limegreen' : '#808080'));
screen.ledBox.onToggle(5);

// ── Mode selector (composed <select>) ─────────────────────────────────────
// modeValue cycles through Auto/Manual/Off on GPIO15.
ui.bind(screen.modeValue, 'text', () => (
  screen.modeValue.value === 0 ? 'Auto' : screen.modeValue.value === 1 ? 'Manual' : 'Off'
));
ui.bind(screen.modeValue, 'color', () => (screen.modeValue.value === 0 ? 'limegreen' : 'khaki'));
screen.modeValue.onChange(15, 3);

// ── Inputs ─────────────────────────────────────────────────────────────────
ui.watchPin(4, () => { screen.counter.value = screen.counter.value + 1; });

setInterval(() => {
  screen.counter.value = screen.counter.value + 1;
}, 2000);
