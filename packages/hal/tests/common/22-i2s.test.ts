import { describe, done } from '@typecad/hal/testing';
// I2S loopback — ONE JUMPER: bridge the board's i2s0 O_SD pad to I_SD.
// On the esp32s3_devkitC (i2s0_default): O_SD = GPIO38, I_SD = GPIO41.
// Write a tone block, read it back through the wire, assert the samples.
import { I2S, Time } from '@typecad/hal';

let got0 = -99999;
let got1 = -99999;
let got2 = -99999;
let got3 = -99999;

const audio = new I2S(0, { hz: 16000, channels: 2, blockFrames: 16 });
audio.write([1000, -1000, 2000, -2000]);

describe("I2S loopback round-trip")
  .it("a written block returns through the read path intact")
  .expect(
    (() => {
      // The DMA needs time to clock the block out and back.
      Time.sleep(500);
      got0 = audio.read();
      got1 = audio.readAt(1);
      got2 = audio.readAt(2);
      got3 = audio.readAt(3);
      // Monaural-in-stereo: the wire is O_SD→I_SD; both channels share the
      // same data line so both carry the same sample stream.
      if (got0 === 1000 && got1 === -1000 && got2 === 2000 && got3 === -2000) {
        return 1;
      }
      return 0;
    })
  ).toBe(1)

done();
