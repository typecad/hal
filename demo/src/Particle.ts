import { Point2D, Velocity } from './types';

export class Particle {
  position: Point2D;
  velocity: Velocity;
  mass: number;

  constructor(x: number, y: number, dx: number, dy: number) {
    this.position = { x, y };
    this.velocity = { dx, dy };
    this.mass = 1.0;
  }

  update(deltaTime: number): void {
    this.position.x += this.velocity.dx * deltaTime;
    this.position.y += this.velocity.dy * deltaTime;
  }

  kineticEnergy(): number {
    return 0.5 * this.mass * (this.velocity.dx * this.velocity.dx + this.velocity.dy * this.velocity.dy);
  }
}