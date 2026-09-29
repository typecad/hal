// ---------------------------------------------------------------------------
// main.ts — CRC link (Black Pill + console UART + pot + button)
//
// A bit-level workload: the pot sets a payload byte, the button triggers a
// frame TX. Frames are length-prefixed byte arrays with a CRC-8 (poly
// 0x07) tail; the console prints the frame as a hex dump and a bit-bar.
// Every encoder path is shifts, masks, XORs and compound bitwise
// assignment — the register-model half of embedded TS.
// ---------------------------------------------------------------------------

import {
  GPIO, LED, BUTTON, PA1,
  ADC, UART0,
  Time, Trace,
} from '@typecad/hal';

// ── Tunables ───────────────────────────────────────────────────────────────
const FRAME_INTERVAL_MS = 4000;
const MAX_PAYLOAD = 8;

// ── CRC-8 (poly 0x07, init 0x00) — pure shifts and XOR ─────────────────────
function crc8(data: number[]): number {
  let crc = 0;
  for (const byte of data) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      if ((crc & 0x80) !== 0) {
        crc = ((crc << 1) ^ 0x07) & 0xFF;
      } else {
        crc = crc << 1;
      }
      crc &= 0xFF;
    }
  }
  return crc & 0xFF;
}

// Hex digits via the documented byte→char idiom (String.fromCharCode is
// not lowered): index a literal of the uppercase hex alphabet.
const HEX_ALPHABET = '0123456789ABCDEF';

/** One byte's high nibble → '0'..'F'. */
function hexDigit(v: number): string {
  return HEX_ALPHABET[v & 0x0F];
}

/** `0x5A` form. */
function hexByte(v: number): string {
  return `0x${hexDigit((v >> 4) & 0xF)}${hexDigit(v & 0xF)}`;
}

/** Interleave the low bits of two bytes (a bit-packing idiom). */
function interleave(a: number, b: number): number {
  let out = 0;
  for (let i = 0; i < 4; i += 1) {
    const abit = (a >> i) & 1;
    const bbit = (b >> i) & 1;
    out |= (abit << (i * 2));
    out |= (bbit << (i * 2 + 1));
  }
  return out & 0xFF;
}

/** Rotate-left through 8 bits. */
function rol8(v: number, n: number): number {
  const sh = n & 7;
  return ((v << sh) | (v >>> (8 - sh))) & 0xFF;
}

/** Length-prefixed frame with a CRC-8 tail: [len, ...payload, crc]. */
function buildFrame(payload: number[]): number[] {
  const frame: number[] = [];
  frame.push(payload.length & 0xFF);
  for (const b of payload) {
    frame.push(b & 0xFF);
  }
  frame.push(crc8(payload));
  return frame;
}

/** Hex dump: `4A 20 FF` per byte, comma-separated. */
function hexDump(bytes: number[]): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 1) {
    if (i > 0) {
      out += ' ';
    }
    out += hexByte(bytes[i]);
  }
  return out;
}

/** 8-cell bit bar of a byte: `#..##...` (MSB first). */
function bitBar(v: number): string {
  let s = '';
  for (let bit = 7; bit >= 0; bit -= 1) {
    s += ((v >> bit) & 1) === 1 ? '#' : '.';
  }
  return s;
}

// ── Hardware ───────────────────────────────────────────────────────────────
const pot = new ADC(PA1);
const led = new GPIO(LED, GPIO.OUTPUT);
const button = new GPIO(BUTTON, GPIO.INPUT | GPIO.PULL_UP);

let send = false;
button.onInterrupt(GPIO.INT_EDGE_FALLING, () => {
  send = true;
});

UART0.writeLine('[boot] crc-link up — pot sets payload, button transmits');

let frames = 0;
let lastTx = Time.now();

while (true) {
  const mv = pot.readMillivolts();

  if (send || Time.now() - lastTx >= FRAME_INTERVAL_MS) {
    send = false;
    lastTx = Time.now();

    // Payload: the pot value split into bytes, plus a rol-scrambled byte.
    const payload: number[] = [];
    payload.push((mv >> 8) & 0xFF);
    payload.push(mv & 0xFF);
    payload.push(rol8(mv & 0xFF, frames & 7));
    if (payload.length < MAX_PAYLOAD) {
      payload.push(interleave(0x3C, frames & 0xFF));
    }
    const frame = buildFrame(payload);
    frames += 1;
    Trace.event('frame', frames);

    UART0.writeLine(`tx#${frames} payload=${hexDump(payload)}`);
    UART0.writeLine(`    frame=${hexDump(frame)} crc=ok len=${frame.length}`);
    UART0.writeLine(`    crc byte: ${hexByte(frame[frame.length - 1])} ${bitBar(frame[frame.length - 1])}`);
  }

  led.set((frames & 1) === 1);
  Time.sleep(50);
}
