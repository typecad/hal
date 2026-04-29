/**
 * Pin factory function stubs emitted into generated pins.ts files.
 * These are no-op at runtime and consumed by the transpiler for type checking.
 */

type PinFactoryVariant = "digital" | "pwm" | "analog" | "interrupt" | "pwm-interrupt" | "analog-pwm" | "full";

const VARIANT_SIGNATURES: Record<PinFactoryVariant, { name: string; returnType: string }> = {
  digital: { name: "createDigitalPin", returnType: "BasePin" },
  pwm: { name: "createPWMPin", returnType: "PWMPin" },
  analog: { name: "createAnalogPin", returnType: "AnalogPin" },
  interrupt: { name: "createInterruptPin", returnType: "BasePin & InterruptPin" },
  "pwm-interrupt": { name: "createPWMInterruptPin", returnType: "BasePin & PWMPin & InterruptPin" },
  "analog-pwm": { name: "createAnalogPWMPin", returnType: "BasePin & PWMPin & AnalogPin" },
  full: { name: "createFullPin", returnType: "BasePin & PWMPin & AnalogPin & InterruptPin" },
};

export function generatePinFactoryStubs(variants: PinFactoryVariant[]): string {
  return variants
    .map((v) => {
      const { name, returnType } = VARIANT_SIGNATURES[v];
      return [
        `function ${name}(pin: number, gpio: number): ${returnType} {`,
        `  return { number: pinNumber(pin), gpio: pinNumber(gpio) } as ${returnType};`,
        `}`,
      ].join("\n");
    })
    .join("\n\n");
}

/** All variants for board-scaffold (data-driven path) */
export const ALL_PIN_FACTORY_VARIANTS: PinFactoryVariant[] = [
  "digital",
  "pwm",
  "analog",
  "interrupt",
  "pwm-interrupt",
  "analog-pwm",
  "full",
];

/** Basic variants for templates (wizard/template path) */
export const BASIC_PIN_FACTORY_VARIANTS: PinFactoryVariant[] = [
  "digital",
  "pwm",
  "analog",
  "interrupt",
];
