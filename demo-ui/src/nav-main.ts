import { ui } from '@typecad/ui';
import { screen as navScreen } from './nav.ui.html';

ui.mount(navScreen, {
  display: 'ili9341',
  bus: 'SPI',
  cs: 5,
  dc: 21,
  rst: 22,
});

navScreen.navCounter.value = 0;
ui.bind(navScreen.navCounter, 'text', () => `Count: ${navScreen.navCounter.value}`);

// Animate the counter on the home screen.
setInterval(() => {
  navScreen.navCounter.value++;
}, 1000);
