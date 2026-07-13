import { ui } from '@typecad/ui';
import { screen as navScreen } from './nav.ui.html';

ui.mount(navScreen);

navScreen.navCounter.value = 0;
ui.bind(navScreen.navCounter, 'text', () => `Count: ${navScreen.navCounter.value}`);

// Animate the counter on the home screen.
setInterval(() => {
  navScreen.navCounter.value++;
}, 1000);
