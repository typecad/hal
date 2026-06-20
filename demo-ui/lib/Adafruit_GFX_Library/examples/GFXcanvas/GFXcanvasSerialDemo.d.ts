import type { GFXcanvas1 } from "../../Adafruit_GFX";
import type { GFXcanvas8 } from "../../Adafruit_GFX";
import type { GFXcanvas16 } from "../../Adafruit_GFX";

export declare class GFXcanvas1SerialDemo extends GFXcanvas1 {
  constructor(w: number, h: number);
  print(rotated: boolean): void;
}
export declare class GFXcanvas8SerialDemo extends GFXcanvas8 {
  constructor(w: number, h: number);
  print(rotated: boolean): void;
}
export declare class GFXcanvas16SerialDemo extends GFXcanvas16 {
  constructor(w: number, h: number);
  print(rotated: boolean): void;
}
