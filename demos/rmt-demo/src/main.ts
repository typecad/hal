// RMT demo — ESP32-S3 onboard WS2812 RGB LED (GPIO48).
// Drives the addressable RGB via an RmtChannel (bytes-encoder, 10MHz ticks),
// animating a smooth green breathe.
//
// WS2812 is MSB-first (confirmed against the working Xorlent/ESP32_WS2812B
// reference, which sets flags.msb_first = 1). Sending LSB-first reverses every
// byte's bits: constant values look steady (consistently wrong brightness) but
// a changing ramp jumps to arbitrary brightness levels — visible jitter.
import { LED } from '@typecad/board-esp32s3';
import { RmtChannel, delay } from '@typecad/hal';

const led = new RmtChannel(LED);

// WS2812 timings at 10MHz ticks (1 tick = 0.1us):
//   T0H 0.35us ~ 4 ticks high, T0L 0.9us ~ 9 ticks low
//   T1H 0.9us  ~ 9 ticks high, T1L 0.35us ~ 4 ticks low
//   msbFirst = true (WS2812 sends the most-significant bit first).
led.txInit(
  10000000,    // resolutionHz
  4, 9,        // bit0 [hi, lo]
  9, 4,        // bit1 [hi, lo]
  true,        // msbFirst — WS2812 is MSB-first
);

// GRB byte order for WS2812: green ramps, red/blue off.
let level = 0;
while (true) {
  led.txWriteBytes([level, 0, 0]);
  led.txWaitDone();
  level = (level + 1) % 256;
  delay(15);
}
