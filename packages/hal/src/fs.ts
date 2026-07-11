import { rawCpp } from './emit.js';
import { include } from './include.js';

/**
 * FSClass provides a high-level abstraction for filesystem operations.
 * Maps to SD.h or LittleFS depending on the board configuration.
 */
export class FSClass {
  static readonly __instance_name = "FS";

  begin(): boolean {
    include("<FS.h>");
    rawCpp(`return FS.begin();`);
    return true;
  }

  readText(path: string): string {
    include("<FS.h>");
    rawCpp(`File f = FS.open(${path}.c_str(), "r");`);
    rawCpp(`if (!f) return "";`);
    rawCpp(`String s = f.readString();`);
    rawCpp(`f.close();`);
    rawCpp(`return s.c_str();`);
    return "";
  }

  writeText(path: string, content: string): void {
    include("<FS.h>");
    rawCpp(`File f = FS.open(${path}.c_str(), "w");`);
    rawCpp(`if (f) { f.print(${content}.c_str()); f.close(); }`);
  }

  exists(path: string): boolean {
    include("<FS.h>");
    rawCpp(`return FS.exists(${path}.c_str());`);
    return false;
  }

  remove(path: string): boolean {
    include("<FS.h>");
    rawCpp(`return FS.remove(${path}.c_str());`);
    return false;
  }
}

export const FS = new FSClass();
