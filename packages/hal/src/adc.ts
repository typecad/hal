import { adcRead, adcSetReference, boardResolve } from './emit';

export class ADCClass {
  static readonly __instance_name = "ADC";
  static readonly __default_fields = { _reference: "DEFAULT" };
  _reference: string;

  constructor() {
    this._reference = "DEFAULT";
  }

  getAnalogResolution(): number {
    return boardResolve("peripherals.adc.0.resolution");
  }

  setAnalogReference(ref: number): void {
    this._reference = String(ref);
    adcSetReference(ref);
  }

  getAnalogReference(): number {
    return boardResolve("peripherals.adc.0.referenceVoltages." + this._reference);
  }

  read(pin: number): number {
    return adcRead(pin);
  }
}

export const ADC = new ADCClass();
