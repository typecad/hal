// ---------------------------------------------------------------------------
// Interactive board package wizard
//
// Walks the user through every option for creating a board package.
// ---------------------------------------------------------------------------

import * as readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

// The promises-based readline returns an Interface with async question()
type ReadlineInterface = ReturnType<typeof readline.createInterface>;
import type { BoardTemplateOptions } from "./templates";
import type { ArchitectureIdentifier } from "@typecode/core";

// Valid architectures with descriptions
const ARCHITECTURES: Array<{ id: ArchitectureIdentifier; name: string; description: string }> = [
  { id: "avr", name: "AVR (8-bit)", description: "ATmega328P, ATmega2560, etc." },
  { id: "esp32", name: "ESP32", description: "Dual-core Xtensa, WiFi/BT" },
  { id: "esp32s2", name: "ESP32-S2", description: "Single-core Xtensa, USB" },
  { id: "esp32s3", name: "ESP32-S3", description: "Dual-core Xtensa, AI accel" },
  { id: "esp32c3", name: "ESP32-C3", description: "RISC-V, low cost" },
  { id: "rp2040", name: "RP2040", description: "Raspberry Pi Pico, dual-core M0+" },
  { id: "samd", name: "SAMD", description: "ARM Cortex-M0+, USB native" },
  { id: "stm32", name: "STM32", description: "ARM Cortex-M3/M4/M7" },
  { id: "nrf52", name: "nRF52", description: "Nordic BLE, low power" },
];

// Pin capability presets
const PIN_PRESETS = {
  DIGITAL_ONLY: "Digital I/O only",
  DIGITAL_INT: "Digital I/O + Interrupt",
  DIGITAL_PWM: "Digital I/O + PWM",
  ANALOG_INPUT: "Digital I/O + Analog Input",
  ANALOG_PWM: "Digital I/O + Analog Input + PWM",
  FULL: "Digital + Analog + PWM + Interrupt",
};

// Default values per architecture
const ARCH_DEFAULTS: Record<ArchitectureIdentifier, {
  mcu: string;
  clockSpeedMhz: number;
  flashKb: number;
  sramKb: number;
  eepromKb: number;
  vcc: number;
}> = {
  avr: { mcu: "ATmega328P", clockSpeedMhz: 16, flashKb: 32, sramKb: 2, eepromKb: 1, vcc: 5.0 },
  esp32: { mcu: "ESP32", clockSpeedMhz: 240, flashKb: 4096, sramKb: 520, eepromKb: 0, vcc: 3.3 },
  esp32s2: { mcu: "ESP32-S2", clockSpeedMhz: 240, flashKb: 4096, sramKb: 320, eepromKb: 0, vcc: 3.3 },
  esp32s3: { mcu: "ESP32-S3", clockSpeedMhz: 240, flashKb: 8192, sramKb: 512, eepromKb: 0, vcc: 3.3 },
  esp32c3: { mcu: "ESP32-C3", clockSpeedMhz: 160, flashKb: 4096, sramKb: 400, eepromKb: 0, vcc: 3.3 },
  rp2040: { mcu: "RP2040", clockSpeedMhz: 133, flashKb: 2048, sramKb: 264, eepromKb: 0, vcc: 3.3 },
  samd: { mcu: "SAMD21G18A", clockSpeedMhz: 48, flashKb: 256, sramKb: 32, eepromKb: 0, vcc: 3.3 },
  stm32: { mcu: "STM32F103C8", clockSpeedMhz: 72, flashKb: 64, sramKb: 20, eepromKb: 0, vcc: 3.3 },
  nrf52: { mcu: "nRF52840", clockSpeedMhz: 64, flashKb: 1024, sramKb: 256, eepromKb: 0, vcc: 3.3 },
};

export interface WizardResult extends BoardTemplateOptions {
  pins: PinDefinition[];
  peripherals: PeripheralConfig;
}

export interface PinDefinition {
  number: number;
  gpio?: number;
  name: string;
  aliases: string[];
  capabilities: {
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
  };
  functions: Array<{ type: string; instance: number; role: string }>;
  onboardLed?: boolean;
}

export interface PeripheralConfig {
  i2cCount: number;
  spiCount: number;
  uartCount: number;
  adcChannels: number;
  adcResolution: number;
  pwmChannels: number;
  pwmResolution: number;
}

/**
 * Create a readline interface for user input.
 */
function createRL(): ReadlineInterface {
  return readline.createInterface({ input, output });
}

/**
 * Ask a yes/no question.
 */
async function askYesNo(rl: ReadlineInterface, question: string, defaultYes = true): Promise<boolean> {
  const hint = defaultYes ? "[Y/n]" : "[y/N]";
  const answer = await rl.question(`${question} ${hint}: `);
  const trimmed = answer.trim().toLowerCase();
  if (trimmed === "") return defaultYes;
  return trimmed === "y" || trimmed === "yes";
}

/**
 * Ask for a string input.
 */
async function askString(rl: ReadlineInterface, question: string, defaultValue?: string): Promise<string> {
  const hint = defaultValue ? ` [${defaultValue}]` : "";
  const answer = await rl.question(`${question}${hint}: `);
  return answer.trim() || defaultValue || "";
}

/**
 * Ask for a number input.
 */
async function askNumber(rl: ReadlineInterface, question: string, defaultValue: number): Promise<number> {
  while (true) {
    const answer = await rl.question(`${question} [${defaultValue}]: `);
    if (!answer.trim()) return defaultValue;
    const num = Number(answer.trim());
    if (!isNaN(num)) return num;
    console.log("Please enter a valid number.");
  }
}

/**
 * Ask user to select from a list of options.
 */
async function askSelect(
  rl: ReadlineInterface,
  question: string,
  options: string[],
  defaultIndex = 0
): Promise<number> {
  console.log(`\n${question}`);
  options.forEach((opt, i) => {
    const marker = i === defaultIndex ? ">" : " ";
    console.log(`  ${marker} ${i + 1}. ${opt}`);
  });
  
  while (true) {
    const answer = await rl.question(`Select [1-${options.length}] (default ${defaultIndex + 1}): `);
    if (!answer.trim()) return defaultIndex;
    const num = Number(answer.trim());
    if (!isNaN(num) && num >= 1 && num <= options.length) return num - 1;
    console.log(`Please enter a number between 1 and ${options.length}.`);
  }
}

/**
 * Run the interactive board creation wizard.
 */
export async function runBoardWizard(): Promise<WizardResult | null> {
  const rl = createRL();
  
  try {
    console.log("\n╔════════════════════════════════════════════════════════════╗");
    console.log("║        TypeCode Board Package Creation Wizard              ║");
    console.log("║                                                            ║");
    console.log("║  This wizard will guide you through creating a new board   ║");
    console.log("║  package with all pins, peripherals, and capabilities.     ║");
    console.log("╚════════════════════════════════════════════════════════════╝\n");

    // ── Step 1: Basic Information ────────────────────────────────────────
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.log(" STEP 1: Basic Information");
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

    const rawName = await askString(rl, "Board package name (e.g., 'my-custom-board')");
    if (!rawName) {
      console.log("Board name is required. Exiting.");
      return null;
    }
    const name = rawName.toLowerCase().replace(/[\s_]+/g, "-").replace(/[^a-z0-9-]/g, "");
    
    const displayName = await askString(rl, "Display name", name.split("-").map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(" "));
    const vendor = await askString(rl, "Vendor/Manufacturer", "Unknown");

    // ── Step 2: Architecture Selection ────────────────────────────────────
    console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.log(" STEP 2: Architecture Selection");
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

    const archOptions = ARCHITECTURES.map(a => `${a.name} - ${a.description}`);
    const archIndex = await askSelect(rl, "Select target architecture:", archOptions, 0);
    const architecture = ARCHITECTURES[archIndex].id;
    const archDefaults = ARCH_DEFAULTS[architecture];

    console.log(`\n  Selected: ${ARCHITECTURES[archIndex].name}\n`);

    // ── Step 3: MCU Details ───────────────────────────────────────────────
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.log(" STEP 3: MCU Details");
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

    const mcu = await askString(rl, "MCU part number", archDefaults.mcu);
    const clockSpeedMhz = await askNumber(rl, "Clock speed (MHz)", archDefaults.clockSpeedMhz);

    // ── Step 4: Memory Configuration ──────────────────────────────────────
    console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.log(" STEP 4: Memory Configuration");
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

    console.log("  Memory sizes are used for compile-time checks and documentation.\n");
    const flashKb = await askNumber(rl, "Flash memory (KB)", archDefaults.flashKb);
    const sramKb = await askNumber(rl, "SRAM (KB)", archDefaults.sramKb);
    const eepromKb = await askNumber(rl, "EEPROM (KB)", archDefaults.eepromKb);

    // ── Step 5: Arduino CLI Configuration ────────────────────────────────
    console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.log(" STEP 5: Arduino CLI Configuration");
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

    console.log("  The FQBN (Fully Qualified Board Name) tells arduino-cli which");
    console.log("  core to use for compilation.\n");
    
    const fqbnDefault = getFqbnDefault(architecture);
    const fqbn = await askString(rl, "FQBN (e.g., arduino:avr:uno)", fqbnDefault);

    // ── Step 6: Peripheral Count ──────────────────────────────────────────
    console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.log(" STEP 6: Peripheral Configuration");
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

    const i2cCount = await askNumber(rl, "Number of I2C buses", getDefaultPeripheralCount(architecture, "i2c"));
    const spiCount = await askNumber(rl, "Number of SPI buses", getDefaultPeripheralCount(architecture, "spi"));
    const uartCount = await askNumber(rl, "Number of UARTs", getDefaultPeripheralCount(architecture, "uart"));
    const adcChannels = await askNumber(rl, "Number of ADC channels", getDefaultPeripheralCount(architecture, "adc"));
    const adcResolution = await askNumber(rl, "ADC resolution (bits)", architecture.startsWith("esp32") ? 12 : 10);
    const pwmChannels = await askNumber(rl, "Number of PWM channels", getDefaultPeripheralCount(architecture, "pwm"));
    const pwmResolution = await askNumber(rl, "PWM resolution (bits)", 8);

    const peripheralConfig: PeripheralConfig = {
      i2cCount,
      spiCount,
      uartCount,
      adcChannels,
      adcResolution,
      pwmChannels,
      pwmResolution,
    };

    // ── Step 7: Pin Definitions ───────────────────────────────────────────
    console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.log(" STEP 7: Pin Definitions");
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

    const pins: PinDefinition[] = [];
    
    const definePins = await askYesNo(rl, "Would you like to define pins now? (You can also edit the generated files later)", true);
    
    if (definePins) {
      // Digital pins
      const digitalPinCount = await askNumber(rl, "How many digital pins?", getDigitalPinDefault(architecture));
      
      for (let i = 0; i < digitalPinCount; i++) {
        console.log(`\n  --- Digital Pin ${i} ---`);
        const pin = await defineDigitalPin(rl, i, architecture);
        pins.push(pin);
      }

      // Analog pins (separate numbering like Arduino)
      const analogPinCount = await askNumber(rl, "How many analog input pins?", adcChannels);
      
      for (let i = 0; i < analogPinCount; i++) {
        console.log(`\n  --- Analog Pin A${i} ---`);
        const pin = await defineAnalogPin(rl, i, digitalPinCount + i, architecture);
        pins.push(pin);
      }

      // On-board LED
      const hasOnboardLed = await askYesNo(rl, "Does the board have an on-board LED?");
      if (hasOnboardLed) {
        const ledPinNum = await askNumber(rl, "LED pin number", getLedPinDefault(architecture));
        const ledPin = pins.find(p => p.number === ledPinNum);
        if (ledPin) {
          ledPin.onboardLed = true;
          ledPin.aliases.push("LED");
        }
      }
    }

    // ── Step 8: Peripheral Pin Mappings ───────────────────────────────────
    console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.log(" STEP 8: Peripheral Pin Mappings");
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

    if (definePins && pins.length > 0) {
      // I2C mappings
      for (let i = 0; i < i2cCount; i++) {
        console.log(`\n  --- I2C Bus ${i} ---`);
        await defineI2CPins(rl, pins, i);
      }

      // SPI mappings
      for (let i = 0; i < spiCount; i++) {
        console.log(`\n  --- SPI Bus ${i} ---`);
        await defineSPIPins(rl, pins, i);
      }

      // UART mappings
      for (let i = 0; i < uartCount; i++) {
        console.log(`\n  --- UART ${i} ---`);
        await defineUARTPins(rl, pins, i);
      }
    } else {
      console.log("  Skipping peripheral pin mappings (no pins defined yet).");
      console.log("  You can add these manually in the generated files.\n");
    }

    // ── Summary ───────────────────────────────────────────────────────────
    console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.log(" SUMMARY");
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

    console.log(`  Board Name:     ${displayName}`);
    console.log(`  Package:        @typecode/board-${name}`);
    console.log(`  Vendor:         ${vendor}`);
    console.log(`  Architecture:   ${architecture}`);
    console.log(`  MCU:            ${mcu}`);
    console.log(`  Clock:          ${clockSpeedMhz} MHz`);
    console.log(`  Memory:         ${flashKb}KB Flash, ${sramKb}KB SRAM, ${eepromKb}KB EEPROM`);
    console.log(`  FQBN:           ${fqbn}`);
    console.log(`  Peripherals:    ${i2cCount} I2C, ${spiCount} SPI, ${uartCount} UART`);
    console.log(`  ADC:            ${adcChannels} channels @ ${adcResolution}-bit`);
    console.log(`  PWM:            ${pwmChannels} channels @ ${pwmResolution}-bit`);
    console.log(`  Pins defined:   ${pins.length}`);
    console.log("");

    const confirm = await askYesNo(rl, "Generate board package with these settings?");
    
    if (!confirm) {
      console.log("Cancelled.");
      return null;
    }

    return {
      name,
      displayName,
      vendor,
      architecture,
      mcu,
      clockSpeedMhz,
      flashKb,
      sramKb,
      eepromKb,
      fqbn,
      minimal: false,
      pins,
      peripherals: peripheralConfig,
    };
  } finally {
    rl.close();
  }
}

/**
 * Define a digital pin interactively.
 */
async function defineDigitalPin(rl: ReadlineInterface, index: number, architecture: ArchitectureIdentifier): Promise<PinDefinition> {
  const defaultName = `D${index}`;
  const name = await askString(rl, `Pin name`, defaultName);
  
  const gpioDefault = index; // Usually GPIO = pin number
  const gpio = await askNumber(rl, `GPIO number`, gpioDefault);
  
  console.log("\n  Capabilities:");
  const digitalInput = await askYesNo(rl, "  Digital input?", true);
  const digitalOutput = await askYesNo(rl, "  Digital output?", true);
  const pwm = await askYesNo(rl, "  PWM output?", false);
  const interrupt = await askYesNo(rl, "  External interrupt?", isInterruptPinDefault(index, architecture));
  const analogInput = await askYesNo(rl, "  Analog input?", false);
  const pullUp = await askYesNo(rl, "  Internal pull-up?", true);
  const pullDown = architecture !== "avr" ? await askYesNo(rl, "  Internal pull-down?", false) : false;
  const touch = architecture.startsWith("esp32") ? await askYesNo(rl, "  Touch/capacitive?", false) : false;

  return {
    number: index,
    gpio,
    name,
    aliases: [],
    capabilities: {
      digitalInput,
      digitalOutput,
      analogInput,
      analogOutput: pwm, // PWM is a form of analog output
      pwm,
      interrupt,
      pullUp,
      pullDown,
      touch,
      openDrain: false,
    },
    functions: [],
  };
}

/**
 * Define an analog pin interactively.
 */
async function defineAnalogPin(rl: ReadlineInterface, index: number, pinNumber: number, architecture: ArchitectureIdentifier): Promise<PinDefinition> {
  const defaultName = `A${index}`;
  const name = await askString(rl, `Pin name`, defaultName);
  
  const gpioDefault = pinNumber;
  const gpio = await askNumber(rl, `GPIO number`, gpioDefault);
  
  const digitalIo = await askYesNo(rl, "  Also digital I/O?", true);

  return {
    number: pinNumber,
    gpio,
    name,
    aliases: [],
    capabilities: {
      digitalInput: digitalIo,
      digitalOutput: digitalIo,
      analogInput: true,
      analogOutput: false,
      pwm: false,
      interrupt: false,
      pullUp: digitalIo,
      pullDown: false,
      touch: false,
      openDrain: false,
    },
    functions: [],
  };
}

/**
 * Define I2C pin mappings.
 */
async function defineI2CPins(rl: ReadlineInterface, pins: PinDefinition[], busIndex: number): Promise<void> {
  const sdaDefault = findPinByName(pins, "SDA")?.number ?? findPinByNumber(pins, getDefaultI2CPins("sda", busIndex))?.number;
  const sclDefault = findPinByName(pins, "SCL")?.number ?? findPinByNumber(pins, getDefaultI2CPins("scl", busIndex))?.number;
  
  const sda = await askNumber(rl, `  SDA pin number`, sdaDefault ?? 0);
  const scl = await askNumber(rl, `  SCL pin number`, sclDefault ?? 0);
  
  const sdaPin = pins.find(p => p.number === sda);
  const sclPin = pins.find(p => p.number === scl);
  
  if (sdaPin) {
    sdaPin.functions.push({ type: "i2c", instance: busIndex, role: "sda" });
    if (!sdaPin.aliases.includes("SDA")) sdaPin.aliases.push(busIndex === 0 ? "SDA" : `SDA${busIndex}`);
  }
  if (sclPin) {
    sclPin.functions.push({ type: "i2c", instance: busIndex, role: "scl" });
    if (!sclPin.aliases.includes("SCL")) sclPin.aliases.push(busIndex === 0 ? "SCL" : `SCL${busIndex}`);
  }
}

/**
 * Define SPI pin mappings.
 */
async function defineSPIPins(rl: ReadlineInterface, pins: PinDefinition[], busIndex: number): Promise<void> {
  const mosiDefault = findPinByName(pins, "MOSI")?.number ?? findPinByNumber(pins, getDefaultSPIPins("mosi", busIndex))?.number;
  const misoDefault = findPinByName(pins, "MISO")?.number ?? findPinByNumber(pins, getDefaultSPIPins("miso", busIndex))?.number;
  const sckDefault = findPinByName(pins, "SCK")?.number ?? findPinByNumber(pins, getDefaultSPIPins("sck", busIndex))?.number;
  const ssDefault = findPinByName(pins, "SS")?.number ?? findPinByNumber(pins, getDefaultSPIPins("ss", busIndex))?.number;
  
  const mosi = await askNumber(rl, `  MOSI pin number`, mosiDefault ?? 0);
  const miso = await askNumber(rl, `  MISO pin number`, misoDefault ?? 0);
  const sck = await askNumber(rl, `  SCK pin number`, sckDefault ?? 0);
  const ss = await askNumber(rl, `  SS/CS pin number`, ssDefault ?? 0);
  
  const mosiPin = pins.find(p => p.number === mosi);
  const misoPin = pins.find(p => p.number === miso);
  const sckPin = pins.find(p => p.number === sck);
  const ssPin = pins.find(p => p.number === ss);
  
  if (mosiPin) {
    mosiPin.functions.push({ type: "spi", instance: busIndex, role: "mosi" });
    if (!mosiPin.aliases.includes("MOSI")) mosiPin.aliases.push(busIndex === 0 ? "MOSI" : `MOSI${busIndex}`);
  }
  if (misoPin) {
    misoPin.functions.push({ type: "spi", instance: busIndex, role: "miso" });
    if (!misoPin.aliases.includes("MISO")) misoPin.aliases.push(busIndex === 0 ? "MISO" : `MISO${busIndex}`);
  }
  if (sckPin) {
    sckPin.functions.push({ type: "spi", instance: busIndex, role: "sck" });
    if (!sckPin.aliases.includes("SCK")) sckPin.aliases.push(busIndex === 0 ? "SCK" : `SCK${busIndex}`);
  }
  if (ssPin) {
    ssPin.functions.push({ type: "spi", instance: busIndex, role: "ss" });
    if (!ssPin.aliases.includes("SS")) ssPin.aliases.push(busIndex === 0 ? "SS" : `SS${busIndex}`);
  }
}

/**
 * Define UART pin mappings.
 */
async function defineUARTPins(rl: ReadlineInterface, pins: PinDefinition[], busIndex: number): Promise<void> {
  const txDefault = findPinByName(pins, "TX")?.number ?? findPinByNumber(pins, getDefaultUARTPins("tx", busIndex))?.number;
  const rxDefault = findPinByName(pins, "RX")?.number ?? findPinByNumber(pins, getDefaultUARTPins("rx", busIndex))?.number;
  
  const tx = await askNumber(rl, `  TX pin number`, txDefault ?? 0);
  const rx = await askNumber(rl, `  RX pin number`, rxDefault ?? 0);
  
  const txPin = pins.find(p => p.number === tx);
  const rxPin = pins.find(p => p.number === rx);
  
  if (txPin) {
    txPin.functions.push({ type: "uart", instance: busIndex, role: "tx" });
    if (!txPin.aliases.includes("TX")) txPin.aliases.push(busIndex === 0 ? "TX" : `TX${busIndex}`);
  }
  if (rxPin) {
    rxPin.functions.push({ type: "uart", instance: busIndex, role: "rx" });
    if (!rxPin.aliases.includes("RX")) rxPin.aliases.push(busIndex === 0 ? "RX" : `RX${busIndex}`);
  }
}

// ── Helper Functions ─────────────────────────────────────────────────────

function getFqbnDefault(arch: ArchitectureIdentifier): string {
  const defaults: Record<ArchitectureIdentifier, string> = {
    avr: "arduino:avr:uno",
    esp32: "esp32:esp32:esp32dev",
    esp32s2: "esp32:esp32:esp32s2",
    esp32s3: "esp32:esp32:esp32s3",
    esp32c3: "esp32:esp32:esp32c3",
    rp2040: "rp2040:rp2040:rpipico",
    samd: "adafruit:samd:adafruit_metro_m0",
    stm32: "stm32duino:STM32F1:genericSTM32F103C",
    nrf52: "adafruit:nrf52:feather52840",
  };
  return defaults[arch];
}

function getDefaultPeripheralCount(arch: ArchitectureIdentifier, type: string): number {
  const defaults: Record<ArchitectureIdentifier, Record<string, number>> = {
    avr: { i2c: 1, spi: 1, uart: 1, adc: 6, pwm: 6 },
    esp32: { i2c: 2, spi: 2, uart: 3, adc: 18, pwm: 16 },
    esp32s2: { i2c: 2, spi: 2, uart: 2, adc: 20, pwm: 8 },
    esp32s3: { i2c: 2, spi: 2, uart: 3, adc: 20, pwm: 8 },
    esp32c3: { i2c: 1, spi: 1, uart: 2, adc: 6, pwm: 6 },
    rp2040: { i2c: 2, spi: 2, uart: 2, adc: 4, pwm: 16 },
    samd: { i2c: 1, spi: 1, uart: 1, adc: 8, pwm: 8 },
    stm32: { i2c: 2, spi: 2, uart: 3, adc: 10, pwm: 12 },
    nrf52: { i2c: 2, spi: 2, uart: 1, adc: 8, pwm: 4 },
  };
  return defaults[arch]?.[type] ?? 1;
}

function getDigitalPinDefault(arch: ArchitectureIdentifier): number {
  const defaults: Record<ArchitectureIdentifier, number> = {
    avr: 14,
    esp32: 34,
    esp32s2: 43,
    esp32s3: 48,
    esp32c3: 22,
    rp2040: 26,
    samd: 14,
    stm32: 32,
    nrf52: 32,
  };
  return defaults[arch] ?? 14;
}

function getLedPinDefault(arch: ArchitectureIdentifier): number {
  const defaults: Record<ArchitectureIdentifier, number> = {
    avr: 13,
    esp32: 2,
    esp32s2: 2,
    esp32s3: 2,
    esp32c3: 8,
    rp2040: 25,
    samd: 13,
    stm32: 13,
    nrf52: 13,
  };
  return defaults[arch] ?? 13;
}

function isInterruptPinDefault(pinIndex: number, arch: ArchitectureIdentifier): boolean {
  // AVR: pins 2, 3 are interrupt pins
  if (arch === "avr") return pinIndex === 2 || pinIndex === 3;
  // Most others: all pins support interrupts
  return true;
}

function getDefaultI2CPins(signal: "sda" | "scl", _bus: number): number {
  // Arduino Uno defaults
  const defaults = { sda: 18, scl: 19 };
  return defaults[signal];
}

function getDefaultSPIPins(signal: "mosi" | "miso" | "sck" | "ss", _bus: number): number {
  // Arduino Uno defaults
  const defaults = { mosi: 11, miso: 12, sck: 13, ss: 10 };
  return defaults[signal];
}

function getDefaultUARTPins(signal: "tx" | "rx", _bus: number): number {
  // Arduino Uno defaults
  const defaults = { tx: 1, rx: 0 };
  return defaults[signal];
}

function findPinByName(pins: PinDefinition[], name: string): PinDefinition | undefined {
  return pins.find(p => p.name === name || p.aliases.includes(name));
}

function findPinByNumber(pins: PinDefinition[], num: number): PinDefinition | undefined {
  return pins.find(p => p.number === num);
}