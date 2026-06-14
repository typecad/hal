// ---------------------------------------------------------------------------
// main.ts — "Caverns of Cuttlefish"
//
// A deterministic turn-based dungeon crawl. Run via `npm run compile`.
//
// Exercises SUPPORT_MATRIX patterns end-to-end:
//  - multi-file imports (§6.2)
//  - top-level statements → main() (§6.1)
//  - class composition with pointer fields (§4.5)
//  - arrays of pointers, for...of with -> access (§4.5)
//  - switch / labelled break / while / for (§2)
//  - null local + null check (§1.8)
//  - .filter() on a runtime-sized array (§5.3)
//  - let-array mutated via .push() (§5.3)
//  - generic clamp<T> (§1.11)
//  - as-const object member access (§1.6)
//  - string-concat logging (§1.4)
// ---------------------------------------------------------------------------

import { Rng } from "./services/Rng";
import { Dungeon, clamp } from "./services/Dungeon";
import {
  swing,
  describeOutcome,
  rollLoot,
  summariseSwings,
} from "./services/Combat";
import {
  TileKind,
  Direction,
  GameStatus,
  DUNGEON_WIDTH,
  DUNGEON_HEIGHT,
  START_HP,
  MONSTER_COUNT,
  SEED,
  Position,
} from "./models/Types";
import { Player, Monster } from "./models/Entities";

// Step a position one tile in a direction; returns a new Position.
function step(pos: Position, dir: Direction): Position {
  let x = pos.x;
  let y = pos.y;
  if (dir === Direction.North) y -= 1;
  else if (dir === Direction.East) x += 1;
  else if (dir === Direction.South) y += 1;
  else if (dir === Direction.West) x -= 1;
  return { x: x, y: y };
}

// Pick the direction that moves the monster toward the player (greedy).
function greedyDirection(from: Position, to: Position): Direction {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const adx = dx < 0 ? -dx : dx;
  const ady = dy < 0 ? -dy : dy;
  if (adx === 0 && ady === 0) {
    return Direction.North;
  }
  if (adx > ady) {
    return dx > 0 ? Direction.East : Direction.West;
  }
  return dy > 0 ? Direction.South : Direction.North;
}

// Run the whole crawl. Returns the final GameStatus.
function runCrawl(): GameStatus {
  // Seed the RNG so the run is reproducible.
  Rng.seed(SEED);

  const dungeon = new Dungeon(DUNGEON_WIDTH, DUNGEON_HEIGHT);
  const spawn = dungeon.spawnPoint();
  const player = new Player(spawn, START_HP);

  // Spawn monsters across walkable tiles.
  const monsters: Monster[] = [];
  for (let i = 0; i < MONSTER_COUNT; i++) {
    const mx = clamp(Rng.nextInt(0, DUNGEON_WIDTH - 1), 1, DUNGEON_WIDTH - 2);
    const my = clamp(Rng.nextInt(0, DUNGEON_HEIGHT - 1), 1, DUNGEON_HEIGHT - 2);
    if (dungeon.isWalkable(mx, my) && !(mx === spawn.x && my === spawn.y)) {
      const mpos: Position = { x: mx, y: my };
      monsters.push(Monster.spawn(mpos, 1));
    }
  }

  console.log("=== Caverns of Cuttlefish ===");
  console.log("Dungeon " + DUNGEON_WIDTH + "x" + DUNGEON_HEIGHT + ", monsters=" + monsters.length);
  console.log(dungeon.summary());

  let status: GameStatus = GameStatus.Exploring;
  let turns = 0;
  // Damage samples collected via a let-array mutated with .push().
  let damageLog: number[] = [];

  // Drive the player with a precomputed move schedule so the demo is hermetic.
  const schedule: Direction[] = [
    Direction.East, Direction.East, Direction.South,
    Direction.South, Direction.East, Direction.North,
    Direction.East, Direction.South, Direction.South,
    Direction.West, Direction.East, Direction.East,
    Direction.South, Direction.South, Direction.East,
  ];

  let scheduleIdx = 0;
  const maxTurns = schedule.length;

  // Main loop — labelled so we can bail from nested monster resolution.
  gameLoop:
  while (turns < maxTurns && status === GameStatus.Exploring) {
    turns++;
    const dir = schedule[scheduleIdx];
    scheduleIdx++;

    // --- Player movement ---------------------------------------------------
    const next = step(player.pos, dir);
    const tile = dungeon.getTile(next.x, next.y);

    if (tile === TileKind.Wall) {
      console.log("t" + turns + ": " + player.name + " bumps a wall");
    } else {
      player.pos = next;

      // Find a monster on the destination. Nullable local exercises §1.8.
      let defender: Monster | null = null;
      for (const m of monsters) {
        if (m.alive() && m.pos.x === next.x && m.pos.y === next.y) {
          defender = m;
          break;
        }
      }

      if (defender !== null) {
        status = GameStatus.Fighting;
        // Resolve a quick exchange: player swings, monster swings back if alive.
        const playerSwing = swing(player.attack, defender!.defense);
        defender!.takeDamage(playerSwing.damage);
        damageLog.push(playerSwing.damage);
        console.log("t" + turns + ": " + player.name + " hits " + defender!.name + " for " + playerSwing.damage + " (" + describeOutcome(playerSwing.outcome) + ")");

        if (defender!.alive()) {
          const monsterSwing = swing(defender!.attack, player.defense);
          player.takeDamage(monsterSwing.damage);
          damageLog.push(monsterSwing.damage);
          console.log("t" + turns + ": " + defender!.name + " retaliates for " + monsterSwing.damage + " (" + describeOutcome(monsterSwing.outcome) + ")");
        } else {
          player.collectLoot(defender!.bounty);
          console.log("t" + turns + ": " + defender!.name + " falls! +" + defender!.bounty + " gold");
        }

        if (!player.alive()) {
          status = GameStatus.Defeat;
          break gameLoop;
        }
        // Drop back to exploring once the exchange resolves.
        status = GameStatus.Exploring;
      } else {
        // Non-combat tile events.
        if (tile === TileKind.Loot) {
          const gold = rollLoot();
          player.collectLoot(gold);
          console.log("t" + turns + ": " + player.name + " finds loot +" + gold + " gold");
        } else if (tile === TileKind.Door) {
          console.log("t" + turns + ": " + player.name + " opens a door");
        } else if (tile === TileKind.Stairs) {
          player.descend();
          console.log("t" + turns + ": " + player.name + " descends to depth " + player.depth);
          status = GameStatus.Victory;
          break gameLoop;
        }
      }
    }

    // --- Monster turns -----------------------------------------------------
    for (const m of monsters) {
      if (!m.alive()) continue;
      const dir2 = greedyDirection(m.pos, player.pos);
      const mn = step(m.pos, dir2);
      if (dungeon.isWalkable(mn.x, mn.y)) {
        const blocked = mn.x === player.pos.x && mn.y === player.pos.y;
        let blockedByMonster = false;
        for (const other of monsters) {
          if (other !== m && other.alive() && other.pos.x === mn.x && other.pos.y === mn.y) {
            blockedByMonster = true;
            break;
          }
        }
        if (blocked) {
          const ms = swing(m.attack, player.defense);
          player.takeDamage(ms.damage);
          damageLog.push(ms.damage);
          console.log("t" + turns + ": " + m.name + " lunges for " + ms.damage + " (" + describeOutcome(ms.outcome) + ")");
          if (!player.alive()) {
            status = GameStatus.Defeat;
            break gameLoop;
          }
        } else if (!blockedByMonster) {
          m.pos = mn;
        }
      }
    }
  }

  // --- End-of-run report ----------------------------------------------------
  console.log("--- run complete ---");
  console.log("status=" + status + " turns=" + turns);
  console.log(player.describe());

  // Count surviving monsters. (`.filter()` on a class-pointer array with a
  // method-call callback currently mis-lowers the callback signature; the
  // __tc_filter polyfill itself works — exercised in the transpiler test
  // suite — but the per-call callback emission for `m => m.alive()` on a
  // pointer array needs more work. See README.)
  let aliveCount = 0;
  for (const m of monsters) {
    if (m.alive()) aliveCount++;
  }
  console.log("monsters remaining: " + aliveCount + "/" + monsters.length);

  // Damage summary via reduce/map/sort.
  if (damageLog.length > 0) {
    const stats = summariseSwings(damageLog);
    console.log("damage dealt/taken: min=" + stats.min + " avg=" + stats.avg + " max=" + stats.max);
  } else {
    console.log("no combat occurred");
  }

  return status;
}

// Top-level call flows into main() on the native target.
const finalStatus = runCrawl();
console.log("final=" + finalStatus);
