// ---------------------------------------------------------------------------
// @typecode/core — Memory placement decorators
//
// These are compile-time markers.  At runtime they are no-ops that attach
// metadata via Reflect; the transpiler reads the metadata when emitting C++.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Memory region enum
// ---------------------------------------------------------------------------

export enum MemoryRegion {
  SRAM     = 'SRAM',
  FLASH    = 'FLASH',
  EEPROM   = 'EEPROM',
  RTC      = 'RTC',
  DMA      = 'DMA',
  EXTERNAL = 'EXTERNAL',
}

// ---------------------------------------------------------------------------
// Metadata interfaces
// ---------------------------------------------------------------------------

export interface MemoryOptions {
  alignment?: number;
  section?: string;
  retain?: boolean;
  zeroInit?: boolean;
  noCache?: boolean;
}

export interface MemoryDecorator {
  region: MemoryRegion;
  options?: MemoryOptions;
}

// ---------------------------------------------------------------------------
// Internal metadata store (WeakMap – no reflect-metadata dependency)
// ---------------------------------------------------------------------------

const metaStore = new WeakMap<object, Map<string | symbol | undefined, MemoryDecorator[]>>();

function setMemoryMeta(
  target: object,
  propertyKey: string | symbol | undefined,
  meta: MemoryDecorator,
): void {
  let map = metaStore.get(target);
  if (!map) {
    map = new Map();
    metaStore.set(target, map);
  }
  const existing = map.get(propertyKey) ?? [];
  existing.push(meta);
  map.set(propertyKey, existing);
}

/** Read the memory decorator metadata previously attached to a target. */
export function getMemoryMeta(
  target: object,
  propertyKey?: string | symbol,
): MemoryDecorator[] {
  return metaStore.get(target)?.get(propertyKey) ?? [];
}

// ---------------------------------------------------------------------------
// Decorator helpers
// ---------------------------------------------------------------------------

type AnyDecorator = ClassDecorator & PropertyDecorator;

function memoryDecorator(region: MemoryRegion, options?: MemoryOptions): AnyDecorator {
  return (target: object, propertyKey?: string | symbol): void => {
    setMemoryMeta(target, propertyKey, { region, options });
  };
}

// ---------------------------------------------------------------------------
// Public decorators
// ---------------------------------------------------------------------------

/** Static / global lifetime.  Emits `static` storage qualifier in C++. */
export function Static(): AnyDecorator {
  return memoryDecorator(MemoryRegion.SRAM, { section: '.bss' });
}

/** Place data in flash / PROGMEM. Critical on AVR with only 2 KB SRAM. */
export function ProgramMemory(): AnyDecorator {
  return memoryDecorator(MemoryRegion.FLASH);
}

/** Remove struct padding (`__attribute__((packed))`). */
export function Packed(): ClassDecorator {
  return memoryDecorator(MemoryRegion.SRAM, { section: 'packed' }) as ClassDecorator;
}

/** Mark a variable as `volatile` to prevent compiler optimisation. */
export function Volatile(): PropertyDecorator {
  return memoryDecorator(MemoryRegion.SRAM, { section: 'volatile' }) as PropertyDecorator;
}

/** Align memory to `bytes` boundary. */
export function Aligned(bytes: number): AnyDecorator {
  return memoryDecorator(MemoryRegion.SRAM, { alignment: bytes });
}

/** Allocate in DMA-capable memory. */
export function DmaBuffer(size?: number): PropertyDecorator {
  return memoryDecorator(MemoryRegion.DMA, { alignment: size }) as PropertyDecorator;
}

/** Store in RTC memory (persists through ESP32 deep sleep). */
export function RtcMemory(): PropertyDecorator {
  return memoryDecorator(MemoryRegion.RTC) as PropertyDecorator;
}

/** Map to a specific EEPROM address range. */
export function EEPROM(address: number, size: number): PropertyDecorator {
  return memoryDecorator(MemoryRegion.EEPROM, {
    section: `eeprom:${address}:${size}`,
  }) as PropertyDecorator;
}

/** Place in external PSRAM / SPIRAM. */
export function External(): PropertyDecorator {
  return memoryDecorator(MemoryRegion.EXTERNAL) as PropertyDecorator;
}

/** Skip zero-initialisation at startup. */
export function NoInit(): PropertyDecorator {
  return memoryDecorator(MemoryRegion.SRAM, { zeroInit: false }) as PropertyDecorator;
}

/** Prevent the linker from stripping an unused symbol. */
export function Retain(): AnyDecorator {
  return memoryDecorator(MemoryRegion.SRAM, { retain: true });
}
