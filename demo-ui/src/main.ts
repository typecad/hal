// ---------------------------------------------------------------------------
// main.ts — cuttlefish UI capability showcase
//
// Static elements (typography/box/flex/layout showcase screens) need no TS —
// they render from HTML+CSS alone. Only stateful/interactive elements are
// wired here. Full wiring is added as the showcase screens land; this minimal
// entry exists from Task 1 so the showcase HTML is in the transpile graph and
// its per-id type declaration (showcase.ui.d.html.ts) is generated.
// ---------------------------------------------------------------------------

import { ui } from '@typecad/ui';
import { screen } from './showcase.ui.html';
import { Adafruit_ILI9341 } from '../lib/Adafruit_ILI9341/Adafruit_ILI9341';

ui.mount(screen, {
  display: 'ili9341',
  bus: 'SPI',
  cs: 5,
  dc: 21,
  rst: 22,
});
