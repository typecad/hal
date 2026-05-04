import { D8 } from '@typehal';

const speaker = D8.asOutput();

// Play 440Hz (A4) indefinitely
speaker.tone(440);

// Stop the tone
speaker.noTone();

// Play a 1000Hz beep for 500ms
speaker.tone(1000).for(400);