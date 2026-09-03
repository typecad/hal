import { ui } from '@typecad/ui';
import { Thread, Time } from '@typecad/hal';
import { screen as navScreen } from './nav.ui.html';

ui.mount(navScreen);

navScreen.navCounter.value = 0;
ui.bind(navScreen.navCounter, 'text', () => `Count: ${navScreen.navCounter.value}`);

// Animate the counter on the home screen. Slot 1 — main.ts owns slot 0.
const navTicker = new Thread(1, { stackKb: 2 });
navTicker.start((): void => {
  while (true) {
    navScreen.navCounter.value++;
    Time.sleep(1000);
  }
});
