import { describe, done } from '@typecad/hal/testing';
// @typecad-requires-roles onewire
// 1-Wire temperature (DS18B20) through the Sensor class: the construction
// is a data-line Pin (bit-banged w1-gpio master, synthesized in the
// overlay) plus the resolution opt. WIRING: DS18B20 VCC→3V3, GND→GND,
// DATA→the onewire role's pin, with a 4.7 kΩ pull-up DATA→3V3 (the
// internal pull-up is weak — the binding says so). The fetch/get verbs are
// the same shape as every bus sensor. The role is ABSENT from the rig's
// test-pins until a probe is wired — add "onewire": "GPIO<pin>" to
// boards/<board>/test-pins.json to run it.
import { ONEWIRE_PIN, SENSOR, CHAN, Sensor, UART0 } from '@typecad/hal';

describe("DS18B20 over 1-Wire")
  .it("constructs on the data pin and fetches a plausible temperature")
  .expect(
    (() => {
      const probe = new Sensor(SENSOR.maxim_ds18b20, ONEWIRE_PIN, { resolution: 12 });
      probe.fetch();
      const celsius = probe.get(CHAN.AMBIENT_TEMP);
      // Indoor bench: -10..60 °C is plausible for any working probe.
      if (celsius > -10 && celsius < 60) {
        UART0.writeLine('ds18b20 ok');
        return 1;
      }
      return 0;
    })
  ).toBe(1)

done();
