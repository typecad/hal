// ---------------------------------------------------------------------------
// main.ts — "Verdant"
//
// A deterministic ecosystem/population simulator. Species across four trophic
// levels (producer, herbivore, carnivore, apex) grow, predate, and migrate
// across a biome. The sim runs a fixed number of ticks and reports population
// dynamics, biodiversity, and a ranked final census.
//
// SUPPORT_MATRIX patterns exercised:
//   §6.2  multi-file local imports
//   §6.1  top-level statements -> main()
//   §1.5  Array<T>, .length, .push()
//   §1.6  interface -> struct, tuple types
//   §1.7  numeric + string enums, relational comparison
//   §2.1  if/else if/else
//   §2.2  for, for...of, while
//   §3.1  free functions + hoisting
//   §4.1  class, readonly fields, static-like factories
//   §4.3  instance methods
//   §4.5  pointer types, -> access
//   §5.2  Math.floor
// ---------------------------------------------------------------------------

import { Rng } from "./services/Rng";
import { Organism, Ecosystem } from "./models/Species";
import {
  Species,
  Population,
  Trophic,
  Biome,
  Point,
  TICKS,
  SEED,
} from "./models/Types";

// Build species definitions. Plain interface literals.
function grass(): Species {
  return {
    id: "grass",
    name: "Meadow Grass",
    trophic: Trophic.Producer,
    growthRate: 0.4,
    carryingCapacity: 500,
  };
}

function rabbit(): Species {
  return {
    id: "rabbit",
    name: "Cottontail",
    trophic: Trophic.Herbivore,
    growthRate: 0.3,
    carryingCapacity: 200,
  };
}

function fox(): Species {
  return {
    id: "fox",
    name: "Red Fox",
    trophic: Trophic.Carnivore,
    growthRate: 0.2,
    carryingCapacity: 80,
  };
}

function wolf(): Species {
  return {
    id: "wolf",
    name: "Grey Wolf",
    trophic: Trophic.Apex,
    growthRate: 0.15,
    carryingCapacity: 30,
  };
}

// Run the simulation. Returns the final biodiversity (alive species count).
function runSim(): number {
  Rng.seed(SEED);
  const eco: Ecosystem = new Ecosystem(Biome.Forest);
  eco.add(new Organism(grass(), 300, { x: 0, y: 0 }));
  eco.add(new Organism(rabbit(), 80, { x: 1, y: 0 }));
  eco.add(new Organism(fox(), 20, { x: 0, y: 1 }));
  eco.add(new Organism(wolf(), 6, { x: 1, y: 1 }));

  console.log("=== Verdant Ecosystem Sim ===");
  console.log("ticks=" + TICKS + " biome=" + biomeLabel(eco.biome));

  for (let t: number = 0; t < TICKS; t++) {
    eco.step();
    const total: number = eco.totalPopulation();
    const bio: number = eco.biodiversity();
    console.log("t" + t + " pop=" + total + " species=" + bio);
  }

  console.log("--- sim complete ---");
  const ranked: Population[] = eco.ranked();
  for (let i: number = 0; i < ranked.length; i++) {
    const p: Population = ranked[i];
    const fitPct: number = Math.floor(p.fitness * 100);
    console.log("  #" + (i + 1) + " " + p.speciesId + " count=" + p.count + " fitness=" + fitPct);
  }

  const finalBio: number = eco.biodiversity();
  console.log("final biodiversity=" + finalBio);
  return finalBio;
}

// Biome label for logging. String-enum equality (§1.7).
function biomeLabel(b: Biome): string {
  if (b === Biome.Forest) {
    return "forest";
  }
  if (b === Biome.Plains) {
    return "plains";
  }
  return "wetland";
}

// top-level -> main()
const result: number = runSim();
console.log("done biodiversity=" + result);
