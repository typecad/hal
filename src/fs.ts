// ---------------------------------------------------------------------------
// File — the thin persistent-file handle
//
// The path is the CONSTRUCTION fact; each verb maps 1:1 onto the Zephyr FS
// API (littlefs on the board's storage partition, mounted lazily on first
// use — there is no begin()/mount session):
//
//   read()    → the file's text ("" when missing/unreadable; the returned
//               buffer lives in the shim until the next read)
//   write(s)  → overwrite the file (no-op when unwritable)
//   exists()  → the file is present
//   remove()  → delete the file
// ----------------------------------------------------------------------------

import {
  fsReadText, fsWriteText, fsExists, fsRemove,
} from './emit.js';

export class File {
  private readonly _path: string;

  constructor(path: string) {
    this._path = path;
  }

  /** Read the file as UTF-8 text. "" when missing/unreadable; the buffer is
   *  shim-owned until the next read. */
  read(): string {
    return fsReadText(this._path);
  }

  /** Overwrite the file with `content`. Silently no-ops when the file
   *  cannot be opened for writing. */
  write(content: string): void {
    fsWriteText(this._path, content);
  }

  /** True if the file exists. */
  exists(): boolean {
    return fsExists(this._path);
  }

  /** Delete the file. */
  remove(): void {
    fsRemove(this._path);
  }
}
