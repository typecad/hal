# Analog (ADC, DAC) & PWM

Three thin classes for varying signals. All three follow the same rule as the rest of the HAL: **construction is the channel setup** — gain/reference for ADC, resolution for DAC, period for PWM — and every method lowers to one Zephyr call in the platform's own units. No 0–255, no 0–1023.

---

## ADC — `ADCChannel`

Construction sets up the channel (`struct adc_channel_cfg`): gain and reference are constructor options, defaulting to the chip descriptor's validated pair when omitted.

```typescript
import { ADCChannel } from '@typecad/hal';
import { A1 } from '@typecad/board';

const sense = new ADCChannel(A1, { gain: ADCChannel.GAIN_1_3, reference: ADCChannel.REF_INTERNAL });

const counts = sense.read();              // raw counts at the chip's resolution
const mv = sense.readMillivolts();        // adc_raw_to_millivolts against the descriptor's vref
```

There is no `setReference()` — Zephyr applies the reference at channel-setup time, and the surface doesn't pretend otherwise. Gain/reference tokens are Zephyr's enum names verbatim under the `ADCChannel.` namespace (`ADC_GAIN_1_4` ↔ `ADCChannel.GAIN_1_4`, `ADC_REF_INTERNAL` ↔ `ADCChannel.REF_INTERNAL`); the token set is generated from the Zephyr tree's headers, so a misspelling is an editor-visible member error and an invalid pair is a build error naming the valid tokens for your chip.

## DAC — `DACChannel`

Construction carries the resolution (bits; omitted = the chip descriptor's channel resolution). `write()` takes the **raw code** — 0–255 for an 8-bit channel, 0–4095 for 12-bit — not a rescaled 0–255 regardless of hardware:

```typescript
import { DACChannel } from '@typecad/hal';

const out = new DACChannel(DAC0);          // 8-bit on the ESP32's two channels
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
- `tone(hz)` — square-wave sugar (50% duty); `tone(0)` stops. See [Utilities](./utilities.md).

On matrix-PWM chips (ESP32 LEDC), channels are assigned at build time to the pins your program actually drives — the overlay emits the pinmux and channel nodes; a pin that can't be a PWM pin is a build error naming the valid ones.

---

## API Reference

### ADCChannel

| Member | Returns | Description |
| :--- | :--- | :--- |
| `new ADCChannel(pin, opts?)` | `ADCChannel` | `gain`, `reference` — `ADCChannel.GAIN_*` / `ADCChannel.REF_*` tokens; omitted = chip descriptor defaults. |
| `read()` | `number` | Raw counts at the chip's resolution (`adc_read` after a one-time channel setup). |
| `readMillivolts()` | `number` | Millivolts (`adc_raw_to_millivolts`). |

### DACChannel

| Member | Returns | Description |
| :--- | :--- | :--- |
| `new DACChannel(pin, opts?)` | `DACChannel` | `resolution` in bits; omitted = the chip descriptor's channel resolution. |
| `write(value)` | `void` | Raw code (`dac_write_value`) — range follows the channel's resolution. |

### PWM

| Member | Returns | Description |
| :--- | :--- | :--- |
| `new PWM(pin, { periodNs })` | `PWM` | Period is required (ns): 50 Hz servo = `20_000_000`. |
| `setPulse(pulseNs)` | `void` | `pwm_set_pulse_dt`. |
| `setDuty(duty)` | `void` | 0.0–1.0 sugar over the constructed period. |
| `setPeriod(periodNs)` | `void` | `pwm_set_dt`; pulse resets to idle — re-set it after. |
| `tone(hz)` | `void` | 50% square wave; `tone(0)` stops. |
