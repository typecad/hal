export declare class TSPoint {
  constructor();
  constructor(x: number, y: number, z: number);
}
export declare class TouchScreen {
  constructor(xp: number, yp: number, xm: number, ym: number, rx: number);
  isTouching(): boolean;
  pressure(): number;
  readTouchY(): number;
  readTouchX(): number;
  getPoint(): any;
}
