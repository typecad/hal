import { Particle } from './Particle';
import { randomRange } from './utils';
import { Star } from './Star';
import { runExtraTests } from './physics';

const VIEWPORT_WIDTH = 80;
const VIEWPORT_HEIGHT = 25;
const STAR_COUNT = 30;
const SIMULATION_STEPS = 100;

function createStar(): Star {
  const x = randomRange(-VIEWPORT_WIDTH, VIEWPORT_WIDTH);
  const y = randomRange(0, VIEWPORT_HEIGHT);
  const speed = randomRange(1, 5);
  const color = randomRange(0, 4);
  return new Star(x, y, speed, color);
}

function renderRow(stars: Star[], y: number): string {
  let output = '';
  for (let x = 0; x < VIEWPORT_WIDTH; x++) {
    let char = ' ';
    for (const star of stars) {
      if (!star.active) continue;
      const px = Math.floor(star.position.x);
      const py = Math.floor(star.position.y);
      if (px === x && py === y) {
        if (star.color === 1) char = '+';
        else if (star.color === 2) char = 'o';
        else if (star.color === 3) char = '.';
        else char = '*';
      }
    }
    output += char;
  }
  return output;
}

function renderFrame(stars: Star[]): void {
  console.log('\n--- Starfield ---\n');
  for (let y = 0; y < VIEWPORT_HEIGHT; y++) {
    console.log(renderRow(stars, y));
  }
}

function testArrays(): void {
  const nums: number[] = [10, 20, 30, 40, 50];
  let sum = 0;
  for (const n of nums) {
    sum += n;
  }
  console.log('Array sum: ' + sum);
}

function testMath(): void {
  const pi = 3.14159;
  const radius = 5;
  const area = pi * radius * radius;
  console.log('Circle area: ' + area);
}

function testStringMethods(): void {
  const text = 'Starfield';
  const upper = text.toUpperCase();
  const lower = text.toLowerCase();
  console.log(upper);
  console.log(lower);
}

function simulate(): void {
  console.log('=== Starfield Simulation Demo ===\n');
  console.log('Viewport: ' + VIEWPORT_WIDTH + 'x' + VIEWPORT_HEIGHT + '\n');

  const stars: Star[] = [];
  for (let i = 0; i < STAR_COUNT; i++) {
    stars.push(createStar());
  }

  console.log('Created ' + STAR_COUNT + ' stars\n');

  for (let step = 0; step < SIMULATION_STEPS; step++) {
    for (const star of stars) {
      star.update(VIEWPORT_WIDTH, VIEWPORT_HEIGHT);
    }
    if (step % 10 === 0) {
      renderFrame(stars);
    }
  }

  const p1 = new Particle(10, 10, 1.5, 0.5);
  const p2 = new Particle(20, 15, -0.5, 1.0);
  
  console.log('\n--- Physics ---\n');
  console.log('Particle 1 KE: ' + p1.kineticEnergy());
  console.log('Particle 2 KE: ' + p2.kineticEnergy());

  console.log('\n--- Utility Tests ---\n');
  testArrays();
  testMath();
  testStringMethods();

  console.log('\n--- Extra Tests ---\n');
  runExtraTests();

  console.log('\n--- Demo Complete ---\n');
}

simulate();