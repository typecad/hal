/**
 * Template-based polyfill generation types.
 * Enables automatic polyfill generation with platform-specific customization.
 */

import { StdLibSupport } from "./types";

/**
 * Architecture capability profile.
 * New architectures only need to define these capabilities,
 * and all polyfills automatically adapt.
 */
export interface ArchitectureCapabilities extends StdLibSupport {
  /** Architecture identifier (e.g., "avr", "esp32", "riscv") */
  id: string;
  /** Human-readable name */
  name: string;
  /** Word size in bits (8, 16, 32, 64) */
  wordSize: number;
  /** Whether the architecture supports dynamic memory allocation */
  hasDynamicMemory: boolean;
  /** Whether the architecture supports templates */
  hasTemplates: boolean;
  /** Whether the architecture supports lambdas */
  hasLambdas: boolean;
  /** Whether the architecture supports std::function */
  hasStdFunction: boolean;
  /** Maximum recommended static array size for embedded targets */
  recommendedStaticArraySize: number;
  /** Maximum recommended static string length for embedded targets */
  recommendedStaticStringLength: number;
  /** Flash string macro (e.g., F(), PSTR()) or empty string */
  flashStringMacro: string;
  /** Serial class name for console output */
  serialClassName: string;
  /** Whether Serial.begin() needs to be called in setup() */
  requiresSerialBegin: boolean;
  /** Default baud rate for Serial */
  defaultBaudRate: number;
}

/**
 * Registry of all known architecture capabilities.
 * Add new architectures here to enable polyfill support.
 */
export const ARCHITECTURE_CAPABILITIES: Record<string, ArchitectureCapabilities> = {
  avr: {
    id: "avr",
    name: "AVR (Arduino Uno/Nano)",
    wordSize: 8,
    hasDynamicMemory: false,
    hasTemplates: true,
    hasLambdas: false,
    hasStdFunction: false,
    hasVector: false,
    hasString: false,
    hasIostream: false,
    hasExceptions: false,
    hasRTTI: false,
    recommendedArrayImpl: "static_array",
    recommendedStringImpl: "static_string",
    recommendedStaticArraySize: 32,
    recommendedStaticStringLength: 64,
    flashStringMacro: "F",
    serialClassName: "Serial",
    requiresSerialBegin: true,
    defaultBaudRate: 9600,
  },
  megaavr: {
    id: "megaavr",
    name: "megaAVR (Arduino Nano Every)",
    wordSize: 8,
    hasDynamicMemory: false,
    hasTemplates: true,
    hasLambdas: false,
    hasStdFunction: false,
    hasVector: false,
    hasString: false,
    hasIostream: false,
    hasExceptions: false,
    hasRTTI: false,
    recommendedArrayImpl: "static_array",
    recommendedStringImpl: "static_string",
    recommendedStaticArraySize: 64,
    recommendedStaticStringLength: 128,
    flashStringMacro: "F",
    serialClassName: "Serial",
    requiresSerialBegin: true,
    defaultBaudRate: 9600,
  },
  esp32: {
    id: "esp32",
    name: "ESP32",
    wordSize: 32,
    hasDynamicMemory: true,
    hasTemplates: true,
    hasLambdas: true,
    hasStdFunction: true,
    hasVector: true,
    hasString: true,
    hasIostream: true,
    hasExceptions: true,
    hasRTTI: true,
    recommendedArrayImpl: "std_vector",
    recommendedStringImpl: "std_string",
    recommendedStaticArraySize: 256,
    recommendedStaticStringLength: 256,
    flashStringMacro: "",
    serialClassName: "Serial",
    requiresSerialBegin: true,
    defaultBaudRate: 115200,
  },
  esp8266: {
    id: "esp8266",
    name: "ESP8266",
    wordSize: 32,
    hasDynamicMemory: true,
    hasTemplates: true,
    hasLambdas: true,
    hasStdFunction: true,
    hasVector: true,
    hasString: true,
    hasIostream: true,
    hasExceptions: true,
    hasRTTI: true,
    recommendedArrayImpl: "std_vector",
    recommendedStringImpl: "std_string",
    recommendedStaticArraySize: 128,
    recommendedStaticStringLength: 128,
    flashStringMacro: "",
    serialClassName: "Serial",
    requiresSerialBegin: true,
    defaultBaudRate: 115200,
  },
  rp2040: {
    id: "rp2040",
    name: "RP2040 (Raspberry Pi Pico)",
    wordSize: 32,
    hasDynamicMemory: true,
    hasTemplates: true,
    hasLambdas: true,
    hasStdFunction: true,
    hasVector: true,
    hasString: true,
    hasIostream: true,
    hasExceptions: true,
    hasRTTI: true,
    recommendedArrayImpl: "std_vector",
    recommendedStringImpl: "std_string",
    recommendedStaticArraySize: 128,
    recommendedStaticStringLength: 128,
    flashStringMacro: "",
    serialClassName: "Serial",
    requiresSerialBegin: true,
    defaultBaudRate: 115200,
  },
  samd: {
    id: "samd",
    name: "SAMD (Arduino Zero/M0)",
    wordSize: 32,
    hasDynamicMemory: true,
    hasTemplates: true,
    hasLambdas: true,
    hasStdFunction: true,
    hasVector: true,
    hasString: true,
    hasIostream: true,
    hasExceptions: false,
    hasRTTI: false,
    recommendedArrayImpl: "std_vector",
    recommendedStringImpl: "std_string",
    recommendedStaticArraySize: 64,
    recommendedStaticStringLength: 128,
    flashStringMacro: "",
    serialClassName: "Serial",
    requiresSerialBegin: true,
    defaultBaudRate: 9600,
  },
  riscv: {
    id: "riscv",
    name: "RISC-V",
    wordSize: 32,
    hasDynamicMemory: true,
    hasTemplates: true,
    hasLambdas: true,
    hasStdFunction: true,
    hasVector: true,
    hasString: true,
    hasIostream: true,
    hasExceptions: true,
    hasRTTI: true,
    recommendedArrayImpl: "std_vector",
    recommendedStringImpl: "std_string",
    recommendedStaticArraySize: 128,
    recommendedStaticStringLength: 128,
    flashStringMacro: "",
    serialClassName: "Serial",
    requiresSerialBegin: true,
    defaultBaudRate: 115200,
  },
  stm32: {
    id: "stm32",
    name: "STM32",
    wordSize: 32,
    hasDynamicMemory: true,
    hasTemplates: true,
    hasLambdas: true,
    hasStdFunction: true,
    hasVector: true,
    hasString: true,
    hasIostream: true,
    hasExceptions: false,
    hasRTTI: false,
    recommendedArrayImpl: "std_vector",
    recommendedStringImpl: "std_string",
    recommendedStaticArraySize: 64,
    recommendedStaticStringLength: 128,
    flashStringMacro: "",
    serialClassName: "Serial",
    requiresSerialBegin: true,
    defaultBaudRate: 115200,
  },
  default: {
    id: "default",
    name: "Generic",
    wordSize: 32,
    hasDynamicMemory: true,
    hasTemplates: true,
    hasLambdas: true,
    hasStdFunction: true,
    hasVector: true,
    hasString: true,
    hasIostream: true,
    hasExceptions: true,
    hasRTTI: true,
    recommendedArrayImpl: "std_vector",
    recommendedStringImpl: "std_string",
    recommendedStaticArraySize: 128,
    recommendedStaticStringLength: 128,
    flashStringMacro: "",
    serialClassName: "Serial",
    requiresSerialBegin: true,
    defaultBaudRate: 9600,
  },
};

/**
 * Gets capabilities for an architecture, falling back to default.
 */
export function getArchitectureCapabilities(architecture?: string): ArchitectureCapabilities {
  if (!architecture) return ARCHITECTURE_CAPABILITIES.default;
  return ARCHITECTURE_CAPABILITIES[architecture.toLowerCase()] ?? ARCHITECTURE_CAPABILITIES.default;
}

/**
 * Template placeholder that gets replaced during generation.
 */
export interface TemplatePlaceholder {
  /** Placeholder name (e.g., "MAX_SIZE", "FLASH_MACRO") */
  name: string;
  /** Description of what this placeholder represents */
  description: string;
  /** Function to resolve the placeholder value from capabilities */
  resolve: (caps: ArchitectureCapabilities, config?: Record<string, any>) => string;
}

/**
 * Polyfill template with platform-specific variants.
 */
export interface PolyfillTemplate {
  /** Template identifier */
  id: string;
  /** Human-readable name */
  name: string;
  /** Description of what this polyfill provides */
  description: string;
  /** Capability requirements for each variant */
  variants: PolyfillVariant[];
  /** Common includes needed by all variants */
  commonIncludes: string[];
  /** Placeholders used in the template */
  placeholders: TemplatePlaceholder[];
}

/**
 * A variant of a polyfill for different capability profiles.
 */
export interface PolyfillVariant {
  /** Variant name (e.g., "std_vector", "static_array") */
  name: string;
  /** Condition for selecting this variant */
  condition: (caps: ArchitectureCapabilities) => boolean;
  /** Required capabilities for this variant */
  requiredCapabilities: (keyof ArchitectureCapabilities)[];
  /** C++ code template with {{placeholder}} markers */
  code: string;
  /** Additional includes for this variant */
  includes: string[];
  /** Forward declarations for this variant */
  forwardDeclarations: string[];
}

/**
 * Resolved polyfill ready for emission.
 */
export interface ResolvedPolyfill {
  /** Polyfill ID */
  id: string;
  /** Generated C++ code */
  code: string;
  /** Required includes */
  includes: string[];
  /** Forward declarations */
  forwardDeclarations: string[];
  /** Setup statements to inject */
  setupStatements: string[];
}

/**
 * Polyfill template registry.
 * Add new polyfill templates here.
 */
export const POLYFILL_TEMPLATES: Map<string, PolyfillTemplate> = new Map();

/**
 * Registers a polyfill template.
 */
export function registerPolyfillTemplate(template: PolyfillTemplate): void {
  POLYFILL_TEMPLATES.set(template.id, template);
}

/**
 * Resolves a polyfill template for a specific architecture.
 */
export function resolvePolyfillTemplate(
  templateId: string,
  capabilities: ArchitectureCapabilities,
  config?: Record<string, any>
): ResolvedPolyfill | null {
  const template = POLYFILL_TEMPLATES.get(templateId);
  if (!template) return null;

  // Find matching variant
  const variant = template.variants.find(v => v.condition(capabilities));
  if (!variant) return null;

  // Resolve placeholders
  let code = variant.code;
  for (const placeholder of template.placeholders) {
    const value = placeholder.resolve(capabilities, config);
    code = code.replace(new RegExp(`\\{\\{${placeholder.name}\\}\\}`, "g"), value);
  }

  // Combine includes
  const includes = [...template.commonIncludes, ...variant.includes];

  return {
    id: template.id,
    code,
    includes,
    forwardDeclarations: variant.forwardDeclarations,
    setupStatements: [],
  };
}