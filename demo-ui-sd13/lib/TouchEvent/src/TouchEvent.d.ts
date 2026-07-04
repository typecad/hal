export declare class TouchEvent {
  constructor(touch: any);
  pollTouchScreen(): void;
  setResolution(xResolution: number, yResolution: number): void;
  setDrawMode(drawMode: any): void;
  calibrate(xMin: number, yMin: number, xMax: number, yMax: number): void;
  setMoveTreshold(threshold: number): void;
  setSwipe(swipeX: number, swipeY: number): void;
  setLongClick(clickLong: number): void;
  setDblClick(dblclick: number): void;
  isInArea(p: any, x1: number, y1: number, x2: number, y2: number): any;
  autocalibrate(which: number): void;
  getMinMax(xmin: number, ymin: number, xmax: number, ymax: number): void;
}
