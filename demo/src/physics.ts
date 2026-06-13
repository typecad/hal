import { Particle } from './Particle';

export function runExtraTests(): void {
  const p = new Particle(10, 10, 1.5, 0.5);
  console.log('Extra: ' + p.kineticEnergy());
}