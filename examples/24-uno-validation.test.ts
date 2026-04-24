import { describe, done } from '@typecode/expect';
import { A0, LED } from '@typecode';

enum Mode {
  Idle = 0,
  Active = 1,
}

const baseline: ReadonlyArray<number> = [1, 2, 3, 4];
const packet = new Uint8Array([0xAA, 0x10, 0x20]);
const config = { timeout: 250 };

const { timeout = 500 } = config;
const [startByte = 0, commandByte = 0, dataByte = 0] = packet;

let x = 1;
const y = x + 2;

function baselineSum(): number {
  let total = 0;

  for (const value of baseline) {
    total += value;
  }

  return total;
}

function chooseMode(flag: boolean): Mode {
  if (flag) {
    return Mode.Active;
  }

  return Mode.Idle;
}

const led = LED.asOutput(false);
led.high();

describe('Uno showcase correctness')
  .it('keeps a simple variable value')
    .expect(x).toBe(1)
  .it('evaluates arithmetic correctly')
    .expect(y).toBe(3)
  .it('sums readonly arrays correctly')
    .expect(baselineSum()).toBe(10)
  .it('destructures typed-array bytes correctly')
    .expect(startByte + commandByte + dataByte).toBe(218)
  .it('preserves object defaults and properties')
    .expect(timeout).toBe(250)
  .it('returns enum-backed values correctly')
    .expect(chooseMode(true)).toBe(1)
  .it('can read the LED pin state after driving it high')
    .expect(LED.read() ? 1 : 0).toBeTruthy()
  .it('keeps the analog input in the Uno ADC range')
    .expect(A0.readAnalog()).toBeWithinRange(0, 1023);

done();
