export interface PinCapabilityFlags {
  digitalInput: boolean;
  digitalOutput: boolean;
  analogInput: boolean;
  analogOutput: boolean;
  pwm: boolean;
  interrupt: boolean;
  pullUp: boolean;
  pullDown: boolean;
  touch: boolean;
  openDrain: boolean;
}
