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

/**
 * A text file in the board's persistent storage: `new File('/settings.json')`.
 * `read()` returns the contents ("" when the file is missing);
 * `write()` replaces them. Files persist across re-flashing the
 * application — they live in the board's storage partition, not the app
 * image.
 */
export class File {
  private readonly _path: string;

  constructor(path: string) {
    this._path = path;
  }

  /** Read the file as text. Returns "" when missing or unreadable. The
   *  returned string is valid until the next read — copy it if you need
   *  to keep it. */
  read(): string {
    return fsReadText(this._path);
  }

  /** Replace the file's contents with `content`. Silently does nothing
   *  when the file cannot be written. */
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
