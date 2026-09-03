# Analog (ADC, DAC) & PWM

Three thin classes for varying signals. All three follow the same rule as the rest of the HAL: **construction is the channel setup** — gain/reference for ADC, resolution for DAC, period for PWM — and every method lowers to one Zephyr call in the platform's own units. No 0–255, no 0–1023.

---

## ADC — `ADC`

Construction sets up the channel (`struct adc_channel_cfg`): gain and reference are constructor options, defaulting to the chip descriptor's validated pair when omitted.

```typescript
import { ADC } from '@typecad/hal';
import { ANY_PIN } from '@typecad/board';

const sense = new ADC(ANY_PIN, { gain: ADC.GAIN_1_3, reference: ADC.REF_INTERNAL });

const counts = sense.read();              // raw counts at the chip's resolution
const mv = sense.readMillivolts();        // adc_raw_to_millivolts against the descriptor's vref
```

There is no `setReference()` — Zephyr applies the reference at channel-setup time, and the surface doesn't pretend otherwise. Gain/reference tokens are Zephyr's enum names verbatim under the `ADC.` namespace (`ADC_GAIN_1_4` ↔ `ADC.GAIN_1_4`, `ADC_REF_INTERNAL` ↔ `ADC.REF_INTERNAL`); the token set is generated from the Zephyr tree's headers, so a misspelling is an editor-visible member error and an invalid pair is a build error naming the valid tokens for your chip.

## DAC — `DAC`

Construction carries the resolution (bits; omitted = the chip descriptor's channel resolution). `write()` takes the **raw code** — 0–255 for an 8-bit channel, 0–4095 for 12-bit — not a rescaled 0–255 regardless of hardware:

```typescript
import { DAC } from '@typecad/hal';
import { ANY_PIN } from '@typecad/board';

const out = new DAC(ANY_PIN);       // 8-bit on the ESP32's two channels
out.write(128);                            // mid-scale
```

## PWM — `PWM`

The period is a **required** construction fact in nanoseconds — the channel's time base exists before any pulse does:

```typescript
import { PWM } from '@typecad/hal';

const servo = new PWM(6, { periodNs: 20_000_000 });   // 50 Hz
servo.setPulse(1_500_000);                            // pwm_set_pulse_dt: 1.5 ms — center

const dimmer = new PWM(7, { periodNs: 1_000_000 });   // 1 kHz LED dimming
dimmer.setDuty(0.5);                                  // sugar → pulse = 0.5 × period
```

- `setPulse(pulseNs)` — the verbatim `pwm_set_pulse_dt`.
- `setDuty(0.0–1.0)` — sugar over the constructed period, still one call.
- `setPeriod(ns)` — `pwm_set_dt`; Zephyr 4.4 has no period-only setter, so the pulse resets to idle — follow with `setPulse`/`setDuty`.

On matrix-PWM chips (ESP32 LEDC), channels are assigned at build time to the pins your program actually drives — the overlay emits the pinmux and channel nodes; a pin that can't be a PWM pin is a build error naming the valid ones.

---

## API Reference

### ADC

| Member | Returns | Description |
| :--- | :--- | :--- |
| `new ADC(pin, opts?)` | `ADC` | `gain`, `reference` — `ADC.GAIN_*` / `ADC.REF_*` tokens; omitted = chip descriptor defaults. |
| `read()` | `number` | Raw counts at the chip's resolution (`adc_read` after a one-time channel setup). |
| `readMillivolts()` | `number` | Millivolts (`adc_raw_to_millivolts`). |

### DAC

| Member | Returns | Description |
| :--- | :--- | :--- |
| `new DAC(pin, opts?)` | `DAC` | `resolution` in bits; omitted = the chip descriptor's channel resolution. |
| `write(value)` | `void` | Raw code (`dac_write_value`) — range follows the channel's resolution. |

### PWM

| Member | Returns | Description |
| :--- | :--- | :--- |
| `new PWM(pin, { periodNs })` | `PWM` | Period is required (ns): 50 Hz servo = `20_000_000`. |
| `setPulse(pulseNs)` | `void` | `pwm_set_pulse_dt`. |
| `setDuty(duty)` | `void` | 0.0–1.0 sugar over the constructed period. |
| `setPeriod(periodNs)` | `void` | `pwm_set_dt`; pulse resets to idle — re-set it after. |

---

## The escape hatch: any pin as any type

When the board's facts don't cover a pin (a family the harvest hasn't
reached, or a routing you know the catalog has wrong), there are two ways
to supply the routing yourself. Both feed the SAME validated pipeline —
they are facts, not bypasses.

**Project facts file** — `cuttlefish.facts.json` beside
`cuttlefish.config.ts`, committed with the project. Merged into the board
manifest at generation: user routes win per pin over every harvested
source (a warning names each shadowing), the board module exports appear,
and the file's hash joins the module fingerprint so edits regenerate.

```jsonc
{
  "boards": {
    "myboard/mysoc": {
      "adc": { "device": "adc1",
               "channels": [{ "pin": 0, "channel": 1, "pinctrl": "adc1_in1_pa1" }] },
      "pwm": { "specs": [{ "pin": 15, "controller": "pwm0", "channel": 2 }] },
      "dac": { "device": "dac1", "channels": [{ "pin": 4, "channel": 1 }] }
    }
  }
}
```

Pins are the global numbers the generated module and diagnostics use.
`pinctrl` is the pinctrl node label (STM32) or pinmux macro token (RP2) the
overlay composes; omit it on families whose analog pads need no mux
(nRF, ESP32, SAM).

**Construction overrides** — inline, per use site, when you don't want a
file:

```typescript
const sense = new ADC(PA0, { channel: 3, device: 'adc1' }); // + optional pinctrl
const servo = new PWM(PB7, { periodNs: 20_000_000, controller: 'pwm0', channel: 2 });
```

The channel/device/controller ride the op: the lowering uses them verbatim,
the unavailable-pin diagnostics stand down, and a marker comment carries
the routing to the overlay regen, which synthesizes the DT node. Scope:
per construction — a second `new ADC(PA0)` without overrides gets the
manifest's answer again.
