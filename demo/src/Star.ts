import { Point2D } from './types';

export class Star {
  position: Point2D;
  prevPosition: Point2D;
  speed: number;
  color: number;
  brightness: number;
  active: boolean;

  constructor(x: number, y: number, speed: number, color: number) {
    this.position = { x, y };
    this.prevPosition = { x, y };
    this.speed = speed;
    this.color = color;
    this.brightness = 1.0;
    this.active = true;
  }

  update(width: number, height: number): void {
    this.prevPosition.x = this.position.x;
    this.prevPosition.y = this.position.y;
    this.position.x += this.speed;
    if (this.position.x > width) {
      this.position.x = 0;
      this.prevPosition.x = 0;
    }
  }

  setBrightness(b: number): void {
    this.brightness = b;
  }
}