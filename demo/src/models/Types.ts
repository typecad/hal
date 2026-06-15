// ---------------------------------------------------------------------------
// Types.ts — shared domain types for the ecosystem simulator.
//
// SUPPORT_MATRIX: §1.6 (interface -> struct), §1.7 (numeric + string enums),
// §1.6 (tuple types), readonly fields.
// ---------------------------------------------------------------------------

// Trophic level in the food web. Numeric enum.
export enum Trophic {
  Producer = 0,
  Herbivore = 1,
  Carnivore = 2,
  Apex = 3,
}

// Biome modifiers. String enum (lowered to const char* per §1.7).
export enum Biome {
  Forest = "forest",
  Plains = "plains",
  Wetland = "wetland",
}

// A 2D coordinate. Plain interface (more idiomatic than a tuple type for
// named-field data; the transpiler lowers this to a clean struct).
export interface Point {
  x: number;
  y: number;
}

// A species definition. Plain interface with readonly fields.
export interface Species {
  readonly id: string;
  readonly name: string;
  readonly trophic: Trophic;
  readonly growthRate: number;
  readonly carryingCapacity: number;
}

// A population snapshot for one species at one tick.
export interface Population {
  speciesId: string;
  count: number;
  fitness: number;
}

// Tunables.
export const TICKS: number = 16;
export const SEED: number = 0xFEEDFACE;
export const INITIAL_FOOD: number = 1000;
export const MIGRATION_RATE: number = 0.05;
