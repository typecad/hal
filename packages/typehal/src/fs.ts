import { emit } from './emit';
import { include } from './include';

/**
 * FSClass provides a high-level abstraction for filesystem operations.
 * Maps to SD.h or LittleFS depending on the board configuration.
 */
export class FSClass {
  static readonly __instance_name = "FS";

  begin(): boolean {
    include("<FS.h>");
    emit(`return FS.begin();`);
    return true;
  }

  readText(path: string): string {
    include("<FS.h>");
    emit(`File f = FS.open(${path}, "r");`);
    emit(`if (!f) return "";`);
    emit(`String s = f.readString();`);
    emit(`f.close();`);
    emit(`return s.c_str();`);
    return "";
  }

  writeText(path: string, content: string): void {
    include("<FS.h>");
    emit(`File f = FS.open(${path}, "w");`);
    emit(`if (f) { f.print(${content}); f.close(); }`);
  }

  exists(path: string): boolean {
    include("<FS.h>");
    emit(`return FS.exists(${path});`);
    return false;
  }

  remove(path: string): boolean {
    include("<FS.h>");
    emit(`return FS.remove(${path});`);
    return false;
  }
}

export const FS = new FSClass();
