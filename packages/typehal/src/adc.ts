import { emit } from './emit';
import { board } from './board';

export class ADCClass {
  static readonly __instance_name = "ADC";
  static readonly __default_fields = { _reference: "DEFAULT" };
  _reference: string;

  constructor() {
    this._reference = "DEFAULT";
  }

  getAnalogResolution(): number {
    emit(`return ${board("peripherals.adc.0.resolution")};`);
    return 0;
  }

  setAnalogReference(ref: number): void {
    this._reference = ref as unknown as string;
    emit(`analogReference(${ref});`);
  }

  getAnalogReference(): number {
    emit(`return ${board("peripherals.adc.0.referenceVoltages." + this._reference)};`);
    return 0;
  }

  read(pin: number): number {
    emit(`return analogRead(${pin});`);
    return 0;
  }
}

export const ADC = new ADCClass();
