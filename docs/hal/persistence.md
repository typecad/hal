# Persistence (Files & Settings)

Two thin classes cover durable state, and both share one guarantee: **values live in the board's storage partition, not the application image — they survive re-flashing the app.** (They do not survive erasing the whole flash.)

- **`File`** — whole-file text I/O on littlefs. The path is the construction fact.
- **`Store`** — typed key/value settings on Zephyr's settings subsystem (ZMS backend). The namespace is the construction fact.

Neither has a session: there is no `begin()`, no `mount()`, no `open()`/`close()`. littlefs mounts lazily on first use; the settings backend loads once at boot. Every verb maps 1:1 onto one Zephyr API call.

---

## File — whole-file text I/O

`File` reads and writes whole UTF-8 text files. The intended shape is small human-readable state: a counter, a last-seen timestamp, a device name, a snippet of JSON.

```typescript
import { File } from '@typecad/hal';
import { UART0 } from '@typecad/board';

const notes = new File('/notes.txt');

notes.write('cuttlefish-was-here');        // overwrite (creates when absent)
if (notes.exists()) {
  UART0.writeLine(notes.read());               // "cuttlefish-was-here"
  notes.remove();                          // delete
  UART0.writeLine(notes.exists() ? 'still there' : 'gone');
}
```

Semantics worth knowing:

- **`read()` returns `""` when the file is missing or unreadable** — the same answer as an empty file. Use `exists()` first when the distinction matters.
- **`write(content)` overwrites** — there is no append. To append, read, concatenate, write back (fine at these sizes).
- **`write()` silently no-ops** when the file cannot be opened for writing (a full or unmountable partition). Size your storage partition for the worst case.
- **Buffer lifetime**: `read()`'s return value lives in the shim until the *next* `read()` — copy what you need before reading another file.
- **Paths are absolute littlefs paths** (`/name.txt`). `write()` creates the *file* when absent, but not parent directories — a path under a directory that doesn't exist fails to open (the write no-ops). Keep files at the root, or extend the shim if you need a tree.

The classic pattern — a boot counter that survives re-flashing — is two lines:

```typescript
const boot = new File('/boot-count.txt');
boot.write(String((Number(boot.read()) || 0) + 1));
```

---

## Store — typed key/value settings

`Store` is the right choice for structured device state: calibration values, accumulated counters, user preferences. The namespace chosen at construction becomes a settings subtree — `new Store('app')` reads and writes `tc/app/<key>` — so multiple stores coexist without colliding, and the values ride Zephyr's settings subsystem (ZMS backend on the storage partition: wear-leveled, deduplicated writes).

```typescript
import { Store } from '@typecad/hal';

const settings = new Store('app');

settings.setInt('bootCount', settings.getInt('bootCount', 0) + 1);
settings.setString('deviceName', 'bench-01');
settings.setBool('telemetryOn', true);
settings.setFloat('calibration', 1.02);

UART0.writeLine(settings.getString('deviceName', 'unnamed'));
settings.remove('calibration');   // delete one key
settings.clear();                 // wipe every tc/app/* key this app wrote
```

The typing is deliberate:

- **Pairs are typed** — `setInt/getInt`, `setFloat/getFloat`, `setBool/getBool`, `setString/getString`. There is no variant-typed `get`; what you wrote is what you read.
- **`get` takes a REQUIRED default** — there is no hidden `0`/`""` magic value for "absent". An unset key reads back as the default you chose, which makes first-boot logic explicit:

  ```typescript
  const boots = settings.getInt('bootCount', 1);   // first boot reads 1
  if (boots === 1) { /* first-run setup */ }
  settings.setInt('bootCount', boots + 1);
  ```

- **String lifetime**: like `File.read()`, a `getString()` result lives in the shim's ring buffer until the next get — copy long-lived strings.

---

## File or Store?

| | `File` | `Store` |
| :--- | :--- | :--- |
| Shape | One whole text document per path | Many typed keys under a namespace |
| Backend | littlefs on the storage partition | Zephyr settings / ZMS |
| Best at | Blobs a human might read/edit: notes, exported JSON, a script | Device state: counters, calibration, flags |
| Whole-file rewrite cost per write | Yes (overwrite semantics) | No (per-key settings commits) |
| Type discipline | None — it's text | Typed pairs with required defaults |

Both survive application re-flashes; neither is a config system for *secrets* — anything in flash is readable by anyone with physical access to the board.

---

## API Reference

### File

| Member | Returns | Description |
| :--- | :--- | :--- |
| `new File(path)` | `File` | Absolute littlefs path (`/notes.txt`). |
| `read()` | `string` | Whole file as UTF-8 text; `""` when missing/unreadable. Buffer valid until the next `read()`. |
| `write(content)` | `void` | Overwrite (creates when absent); no-op when unwritable. |
| `exists()` | `boolean` | True when the file is present. |
| `remove()` | `void` | Delete the file. |

### Store

| Member | Returns | Description |
| :--- | :--- | :--- |
| `new Store(ns)` | `Store` | Namespace (`'app'` → settings subtree `tc/app/`). |
| `setInt/setFloat/setBool/setString(key, v)` | `void` | Write one typed key. |
| `getInt/getFloat/getBool/getString(key, d)` | typed | Read one key; **`d` is required** and returned when the key is absent. |
| `remove(key)` | `void` | Delete one key (no-op when absent). |
| `clear()` | `void` | Delete every key under this store's namespace. |
