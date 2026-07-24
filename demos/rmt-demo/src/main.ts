// RMT demo — ESP32-S3 onboard WS2812 RGB LED (GPIO48).
// Drives the addressable RGB via an RmtChannel (bytes-encoder, 10MHz ticks).
//
// Animates a "breathe" on the green channel: a simple 0..255 ramp using only
// integer arithmetic, so the TX buffer stays uint8_t with no double→uint8
// narrowing. (A full HSV wheel needs float math; keeping this integer-only
// avoids fighting the transpiler's double typing for the POC.)
import { LED } from '@typecad/board-esp32s3';
import { RmtChannel, delay } from '@typecad/hal';

const led = new RmtChannel(LED);

// WS2812 timings at 10MHz ticks (1 tick = 0.1us):
//   T0H 0.35us ~ 4 ticks high, T0L 0.9us ~ 9 ticks low
//   T1H 0.9us  ~ 9 ticks high, T1L 0.35us ~ 4 ticks low
led.txInit(
  10000000,    // resolutionHz
  4, 9,        // bit0 [hi, lo]
  9, 4,        // bit1 [hi, lo]
  false,       // msbFirst
);

// GRB byte order for WS2812: green ramps, red/blue off.
let level = 0;
while (true) {
  led.txWriteBytes([level, 0, 0]);
  led.txWaitDone();
  level = (level + 1) % 256;
  delay(15);
}
