import { describe, done } from '@typecad/hal/testing';
// I2S loopback — ONE JUMPER: bridge the board's i2s0 O_SD pad to I_SD.
// On the esp32s3_devkitC (i2s0_default): O_SD = GPIO38, I_SD = GPIO41.
// The FIRST assertion probes the wire itself: without the jumper its
// failure names the exact bridge to add, instead of a bare sample
// mismatch two assertions deep (demo round 5 residue — the bare
// round-trip failure read as an engine regression when the bench was
// simply unwired).
import { I2S, Time, UART0 } from '@typecad/hal';

const audio = new I2S(0, { hz: 16000, channels: 2, blockFrames: 16 });

describe("I2S loopback")
  .it("the loopback wire is present (jumper O_SD GPIO38 to I_SD GPIO41)")
  .expect(
    (() => {
      // ONE write for the whole suite: a second i2s_buf_write on this
      // driver returns -EIO once the stream is running (bench-observed),
      // so the full-sequence assertion below reads readAt() off the SAME
      // received buffer this drain lands on — no second write exists.
      audio.write([1000, -1000, 2000, -2000]);
      Time.sleep(500);
      // The TX ring may hold queued echoes of earlier traffic — drain
      // until THIS block's first sample arrives (bounded). If the block
      // never lands, got0 keeps its non-1000 value and the assert fails
      // honestly.
      let got0 = 0;
      let drained = 0;
      do {
        got0 = audio.read();
        drained += 1;
      } while (got0 !== 1000 && drained < 32);
      return got0 === 1000 ? 1 : 0;
    })
  ).toBe(1)
  .it("a written block returns through the read path intact")
  .expect(
    (() => {
      // readAt indexes the block the wire assertion landed on — the rest
      // of the sequence must be intact behind sample 0. Monaural-in-
      // stereo: the wire is O_SD→I_SD; both channels carry the same stream.
      const got1 = audio.readAt(1);
      const got2 = audio.readAt(2);
      const got3 = audio.readAt(3);
      if (got1 === -1000 && got2 === 2000 && got3 === -2000) {
        return 1;
      }
      UART0.writeLine('i2s-observed /' + got1.toFixed(0) + '/' + got2.toFixed(0) + '/' + got3.toFixed(0));
      return 0;
    })
  ).toBe(1)

done();
