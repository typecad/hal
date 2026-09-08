// ---------------------------------------------------------------------------
// ADC — the thin Zephyr-shaped analog input
//
// Construction IS the channel setup: gain and reference are constructor
// options (exactly struct adc_channel_cfg), defaulting to the chip
// descriptor's pair when omitted. read() returns raw counts at the chip's
// resolution; readMillivolts() applies adc_raw_to_millivolts. There is no
// setReference() — Zephyr applies the reference at channel-setup time, and
// this surface doesn't promise otherwise.
//
// Gain/reference tokens are Zephyr's enum names under the ADC
// namespace (ADC_GAIN_1_4 ↔ ADC.GAIN_1_4, ADC_REF_INTERNAL ↔
// ADC.REF_INTERNAL); the lowering maps token names to macros.
// ----------------------------------------------------------------------------

import { adcReadRaw, adcReadMv } from './emit.js';
import type { Pin } from './gpio.js';

export class ADC {
  // ── Gain tokens (enum adc_gain, verbatim — generated set, see the
  //    token-sync test) ───────────────────────────────────────────────────
  static readonly GAIN_1_6 = 0x01;
  static readonly GAIN_1_5 = 0x02;
  static readonly GAIN_1_4 = 0x03;
  static readonly GAIN_2_7 = 0x04;
  static readonly GAIN_1_3 = 0x05;
  static readonly GAIN_2_5 = 0x06;
  static readonly GAIN_1_2 = 0x07;
  static readonly GAIN_2_3 = 0x08;
  static readonly GAIN_4_5 = 0x09;
  static readonly GAIN_1 = 0x0a;
  static readonly GAIN_2 = 0x0b;
  static readonly GAIN_3 = 0x0c;
  static readonly GAIN_4 = 0x0d;
  static readonly GAIN_6 = 0x0e;
  static readonly GAIN_8 = 0x0f;
  static readonly GAIN_12 = 0x10;
  static readonly GAIN_16 = 0x11;
  static readonly GAIN_24 = 0x12;
  static readonly GAIN_32 = 0x13;
  static readonly GAIN_64 = 0x14;
  static readonly GAIN_128 = 0x15;

  // ── Reference tokens (enum adc_reference, verbatim) ────────────────────
  static readonly REF_VDD_1 = 0x100;
  static readonly REF_VDD_1_2 = 0x101;
  static readonly REF_VDD_1_3 = 0x102;
  static readonly REF_VDD_1_4 = 0x103;
  static readonly REF_INTERNAL = 0x104;
  static readonly REF_EXTERNAL0 = 0x105;
  static readonly REF_EXTERNAL1 = 0x106;

  private readonly _pin: number;
  private readonly _gain: number | string;
  private readonly _reference: number | string;
  // Routing overrides (the inline escape hatch): when the facts layer does
  // not cover this pin, the construction carries the channel (and optional
  // device label + pinctrl token) the lowering uses verbatim.
  private readonly _channel: number;
  private readonly _device: string;
  private readonly _pinctrl: string;

  /** Construct an analog input channel. Omitted gain/reference fall back to
   *  the chip descriptor's pair (the values the platform's driver validates
   *  against, e.g. STM32's ADC_GAIN_1 + ADC_REF_INTERNAL). */
  constructor(
    pin: number | Pin,
    opts?: { gain?: number; reference?: number; channel?: number; device?: string; pinctrl?: string },
  ) {
    this._pin = typeof pin === 'number' ? pin : pin.number;
    this._gain = opts?.gain ?? '';
    this._reference = opts?.reference ?? '';
    this._channel = opts?.channel ?? -1;
    this._device = opts?.device ?? '';
    this._pinctrl = opts?.pinctrl ?? '';
  }

  /** Read raw counts at the chip's resolution (adc_channel_setup on first
   *  use with the construction gain/reference, then adc_read). */
  read(): number {
    return adcReadRaw(this._pin, this._gain, this._reference, this._channel, this._device, this._pinctrl);
  }

  /** Read millivolts (adc_raw_to_millivolts against the descriptor's
   *  vref). Returns mV. */
  readMillivolts(): number {
    return adcReadMv(this._pin, this._gain, this._reference, this._channel, this._device, this._pinctrl);
  }
}
