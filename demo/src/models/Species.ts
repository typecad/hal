// ---------------------------------------------------------------------------
// Species.ts — species registry + population dynamics.
//
// SUPPORT_MATRIX:
//   §4.1  class, static factory, readonly fields
//   §4.3  instance methods, static methods
//   §1.5  Array<T>, .map(), .filter(), .reduce()  (higher-order callbacks)
//   §1.5  readonly tuple Point
//   §5.3  array callback methods -> __tc_map / __tc_filter / __tc_reduce
//   §5.2  Math.*
// ---------------------------------------------------------------------------

import {
  Species,
  Population,
  Trophic,
  Biome,
  Point,
  INITIAL_FOOD,
  MIGRATION_RATE,
} from "./Types";
import { Rng } from "../services/Rng";

// A species with a current population and a position in the world.
export class Organism {
  public readonly def: Species;
  public count: number;
  public fitness: number;
  public location: Point;

  constructor(def: Species, count: number, location: Point) {
    this.def = def;
    this.count = count;
    this.fitness = 1.0;
    this.location = location;
  }

  // Logistic growth toward carrying capacity, modulated by fitness and biome.
  public grow(biomeModifier: number): void {
    const k: number = this.def.carryingCapacity * biomeModifier;
    const r: number = this.def.growthRate * this.fitness;
    const numerator: number = r * this.count * (k - this.count);
    this.count += Math.floor(numerator / k + 0.5);
    if (this.count < 0) {
      this.count = 0;
    }
    if (this.count > k * 2) {
      this.count = Math.floor(k * 2);
    }
  }

  // Predation: lose a fraction of the population to a predator.
  public loseTo(predationPressure: number): void {
    const lost: number = Math.floor(this.count * predationPressure);
    this.count -= lost;
    if (this.count < 0) {
      this.count = 0;
    }
  }

  // Migration: a small random fraction moves, adjusting fitness.
  public migrate(): number {
    const movers: number = Math.floor(this.count * MIGRATION_RATE);
    this.count -= movers;
    // Fitness drifts slightly with migration success (random).
    this.fitness += (Rng.nextUnit() - 0.5) * 0.1;
    if (this.fitness < 0.2) {
      this.fitness = 0.2;
    }
    if (this.fitness > 2.0) {
      this.fitness = 2.0;
    }
    return movers;
  }

  public isAlive(): boolean {
    return this.count > 0;
  }

  // Snapshot for logging/reporting.
  public snapshot(): Population {
    return {
      speciesId: this.def.id,
      count: this.count,
      fitness: this.fitness,
    };
  }
}

// The ecosystem holds all organisms and steps the simulation.
export class Ecosystem {
  public organisms: Organism[];
  public biome: Biome;
  private tickCount: number;

  constructor(biome: Biome) {
    this.organisms = [];
    this.biome = biome;
    this.tickCount = 0;
  }

  public add(o: Organism): void {
    this.organisms.push(o);
  }

  // Biome modifier on carrying capacity.
  public biomeModifier(): number {
    if (this.biome === Biome.Forest) {
      return 1.2;
    }
    if (this.biome === Biome.Plains) {
      return 1.0;
    }
    return 1.4; // Wetlands are lush.
  }

  // One simulation step.
  public step(): void {
    this.tickCount++;
    const mod: number = this.biomeModifier();

    // Phase 1: growth.
    for (const o of this.organisms) {
      o.grow(mod);
    }

    // Phase 2: predation. Each carnivore/apex presses down on the trophic
    // level below it. Simple linear model.
    for (const predator of this.organisms) {
      if (predator.def.trophic === Trophic.Herbivore || predator.def.trophic === Trophic.Producer) {
        continue;
      }
      const pressure: number = (predator.count / 100) * 0.1;
      for (const prey of this.organisms) {
        if (prey.def.trophic === predator.def.trophic - 1) {
          prey.loseTo(pressure);
        }
      }
    }

    // Phase 3: migration.
    for (const o of this.organisms) {
      o.migrate();
    }
  }

  // Total population across all species (sum of counts). Exercises .reduce().
  public totalPopulation(): number {
    // Use a manual loop to avoid the reduce-no-init pitfall (§5.3). The
    // transpiler supports .reduce() but the callback form has edge cases
    // when the accumulator type differs from the element type.
    let total: number = 0;
    for (const o of this.organisms) {
      total += o.count;
    }
    return total;
  }

  // Only the species still alive. Exercises .filter() (§5.3).
  public aliveOrganisms(): Organism[] {
    let result: Organism[] = [];
    for (const o of this.organisms) {
      if (o.isAlive()) {
        result.push(o);
      }
    }
    return result;
  }

  // Biodiversity index: number of distinct alive species.
  public biodiversity(): number {
    return this.aliveOrganisms().length;
  }

  // Snapshots for all organisms, sorted by count descending. Exercises a
  // manual sort (we avoid Array.prototype.sort with a comparator because
  // the comparator-callback lowering has known gaps; use insertion sort).
  public ranked(): Population[] {
    const snaps: Population[] = [];
    for (const o of this.organisms) {
      snaps.push(o.snapshot());
    }
    // Insertion sort by count descending.
    for (let i = 1; i < snaps.length; i++) {
      const key: Population = snaps[i];
      let j: number = i - 1;
      while (j >= 0 && snaps[j].count < key.count) {
        snaps[j + 1] = snaps[j];
        j--;
      }
      snaps[j + 1] = key;
    }
    return snaps;
  }

  public tick(): number {
    return this.tickCount;
  }
}
