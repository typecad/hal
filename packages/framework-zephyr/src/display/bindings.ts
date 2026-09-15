// ---------------------------------------------------------------------------
// Display binding harvest — the Zephyr tree IS the panel catalog.
//
// Drop-in display support ("no special profiles"): a project declares a DT
// compatible string (display.driver, e.g. 'sitronix,st7796s') plus wiring and
// geometry; everything the devicetree overlay needs to emit a VALID node for
// that panel comes from the binding YAMLs in the user's Zephyr checkout —
// required properties, their defaults, and the include chain (e.g. whether
// the lcd-controller family makes pixel-format mandatory). Same doctrine as
// the board catalog: the installed SDK is the source of truth; no curated
// per-panel database in this package.
//
// The parser is deliberately a shape-reader, not a YAML implementation: it
// extracts `compatible:`, `include:` lists, and per-property `required:`/
// `default:` scalars from Zephyr's binding grammar (2-space nesting, inline
// flow arrays). Anything else is ignored — bindings carry descriptions and
// constraints this consumer does not need.
// ---------------------------------------------------------------------------

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { locateZephyrBaseCheap } from '@typecad/cuttlefish/board-catalog';

/** A required property as harvested from a binding. */
export interface RequiredProp {
  /** Binding type string (e.g. 'int', 'uint8-array', 'boolean'). */
  type?: string;
  /** The binding's default, when it ships one (some props are deliberately
   *  default-free — "panel specific" per the sitronix gamma bindings). */
  default?: BindingDefault;
}

/** A harvested display binding: what the overlay generator needs. */
export interface DisplayBindingInfo {
  /** The compatible string this binding documents. */
  compatible: string;
  /** Required properties (DT name → binding facts). */
  required: Map<string, RequiredProp>;
  /** Every property name the binding (or its include chain) declares,
   *  optional ones included — rotation-style props (madctl) are optional
   *  with neutral defaults, but the drop-in path expresses config rotation
   *  through them, so their presence matters. */
  props: Set<string>;
  /** True when the include chain pulls in lcd-controller.yaml — that family
   *  makes `pixel-format` required (0 = RGB565 per dt-bindings/display/panel.h). */
  requiresPixelFormat: boolean;
}

/** A parsed binding default: scalar or byte-array. */
export type BindingDefault =
  | { kind: 'int'; value: number }
  | { kind: 'bool'; value: boolean }
  | { kind: 'string'; value: string }
  | { kind: 'bytes'; value: number[] };

/** Test seam: override the Zephyr root for hermetic fixtures. */
let rootOverride: string | undefined;

/** @internal Replace the Zephyr tree root (tests only). */
export function __setDisplayBindingRootOverride(root: string | undefined): void {
  rootOverride = root;
  yamlIndex = undefined;
}

let cachedBase: string | undefined;
let yamlIndex: Map<string, string> | undefined;

/** Locate the Zephyr tree via the board catalog's canonical discovery
 *  ($ZEPHYR_BASE → well-known workspaces → installer env-vars). Cached. */
export function findZephyrBase(): string | undefined {
  if (rootOverride) return rootOverride;
  if (cachedBase !== undefined) return cachedBase;
  cachedBase = locateZephyrBaseCheap() ?? undefined;
  return cachedBase;
}

/** Index every binding YAML under dts/bindings by filename (bindings include
 *  each other by bare filename across subdirectories — e.g. a display
 *  binding includes i2c-device.yaml, which lives in bindings/i2c/). */
function bindingIndex(root: string): Map<string, string> {
  if (yamlIndex) return yamlIndex;
  const index = new Map<string, string>();
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      const st = statSync(full);
      if (st.isDirectory()) walk(full);
      else if (entry.endsWith('.yaml') || entry.endsWith('.yml')) index.set(entry, full);
    }
  };
  walk(join(root, 'dts', 'bindings'));
  yamlIndex = index;
  return index;
}

interface RawBinding {
  compatible?: string;
  includes: string[];
  required: Map<string, RequiredProp>;
  props: Set<string>;
}

/** Parse one binding file's shape: compatible, includes, required props. */
function parseBinding(path: string): RawBinding {
  const text = readFileSync(path, 'utf8');
  const includes: string[] = [];
  const required = new Map<string, RequiredProp>();
  const props = new Set<string>();
  let compatible: string | undefined;
  let section: 'none' | 'include' | 'properties' = 'none';
  let currentProp: string | undefined;
  let currentDefault: BindingDefault | undefined;
  let currentType: string | undefined;

  const commitProp = (): void => {
    if (currentProp !== undefined && propIsRequired) {
      const prev = required.get(currentProp);
      required.set(currentProp, {
        type: currentType ?? prev?.type,
        default: finalizeDefault(currentDefault, defaultItems) ?? prev?.default,
      });
    }
    currentProp = undefined;
    currentDefault = undefined;
    currentType = undefined;
    defaultItems = null;
    propIsRequired = false;
  };
  let propIsRequired = false;
  let defaultItems: string[] | null = null;

  for (const rawLine of text.split(/\r?\n/)) {
    if (!rawLine.trim() || rawLine.trimStart().startsWith('#')) continue;
    const indent = rawLine.length - rawLine.trimStart().length;
    const line = rawLine.trim();

    // Block-style default list (default: followed by '- item' lines) —
    // common for long byte arrays the real bindings ship multi-line.
    if (defaultItems !== null) {
      if (indent > 4 && line.startsWith('- ')) {
        defaultItems.push(line.slice(2).trim());
        continue;
      }
      // Dedent ends the list; fall through to normal handling of this line.
      const items = defaultItems;
      defaultItems = null;
      currentDefault = itemsToDefault(items);
    }

    if (indent === 0) {
      commitProp();
      const key = line.split(':')[0]!.trim();
      if (key === 'include') {
        section = 'include';
        collectIncludes(line.slice(line.indexOf(':') + 1), includes);
      } else if (key === 'properties') {
        section = 'properties';
      } else {
        section = 'none';
        if (key === 'compatible') {
          const v = scalarString(line.slice(line.indexOf(':') + 1));
          if (v !== undefined) compatible = v;
        }
      }
      continue;
    }
    if (section === 'include' && indent === 2 && line.startsWith('- ')) {
      collectIncludes(line.slice(2), includes);
    } else if (section === 'properties' && indent === 2) {
      commitProp();
      currentProp = line.split(':')[0]!.trim();
      if (currentProp) props.add(currentProp);
    } else if (section === 'properties' && indent === 4 && currentProp) {
      const key = line.split(':')[0]!.trim();
      const rest = line.slice(line.indexOf(':') + 1).trim();
      if (key === 'required' && rest === 'true') {
        propIsRequired = true;
      } else if (key === 'type') {
        currentType = rest.replace(/["']/g, '') || undefined;
      } else if (key === 'default') {
        if (rest === '') {
          defaultItems = [];  // block list follows
        } else {
          currentDefault = parseDefault(rest);
        }
      }
    }
  }
  commitProp();
  return { compatible, includes, required, props };
}

function finalizeDefault(
  inline: BindingDefault | undefined,
  items: string[] | null,
): BindingDefault | undefined {
  if (items !== null && items.length > 0) return itemsToDefault(items);
  return inline ?? (items !== null ? { kind: 'bytes', value: [] } : undefined);
}

function itemsToDefault(items: string[]): BindingDefault {
  if (items.length === 1) return parseDefault(items[0]!);
  const bytes = items
    .map((t) => {
      const c = t.replace(/["']/g, '');
      return c.toLowerCase().startsWith('0x') ? parseInt(c.slice(2), 16) : parseInt(c, 10);
    })
    .filter((n) => !Number.isNaN(n));
  return { kind: 'bytes', value: bytes };
}

function collectIncludes(fragment: string, out: string[]): void {
  const f = fragment.trim();
  if (!f) return;
  if (f.startsWith('[')) {
    for (const part of f.slice(1, -1).split(',')) pushInclude(part.trim(), out);
  } else if (f.startsWith('- ')) {
    pushInclude(f.slice(2).trim(), out);
  } else {
    pushInclude(f, out);
  }
}

function pushInclude(item: string, out: string[]): void {
  // The `- name: foo.yaml` include form (with optional property-blocklist).
  const m = item.match(/name:\s*(\S+)/);
  const name = (m ? m[1] : item).replace(/["']/g, '');
  if (name.endsWith('.yaml') || name.endsWith('.yml')) out.push(name);
}

function scalarString(fragment: string): string | undefined {
  const f = fragment.trim().replace(/["']/g, '');
  return f || undefined;
}

function parseDefault(rest: string): BindingDefault {
  const f = rest.trim();
  if (f === 'true' || f === 'false') return { kind: 'bool', value: f === 'true' };
  if (f.startsWith('[')) {
    const bytes = f
      .slice(1, f.endsWith(']') ? -1 : undefined)
      .split(',')
      .map((s) => {
        const t = s.trim().replace(/["']/g, '');
        return t.toLowerCase().startsWith('0x')
          ? parseInt(t.slice(2), 16)
          : parseInt(t, 10);
      })
      .filter((n) => !Number.isNaN(n));
    return { kind: 'bytes', value: bytes };
  }
  if (/^-?\d+$/.test(f)) return { kind: 'int', value: parseInt(f, 10) };
  return { kind: 'string', value: f.replace(/["']/g, '') };
}

/** Harvest a display binding by compatible string. Walks the include chain
 *  (child requirements win; the lcd-controller family is detected anywhere
 *  in the chain). Returns undefined for unknown compatibles or when no
 *  Zephyr tree is discoverable. */
export function readDisplayBinding(compatible: string): DisplayBindingInfo | undefined {
  const root = findZephyrBase();
  if (!root) return undefined;
  return readDisplayBindingFrom(compatible, root);
}

/** @internal Same harvest against an explicit root (tests). */
export function readDisplayBindingFrom(
  compatible: string,
  root: string,
): DisplayBindingInfo | undefined {
  const index = bindingIndex(root);
  const visited = new Set<string>();
  const required = new Map<string, RequiredProp>();
  const props = new Set<string>();
  let requiresPixelFormat = false;

  const load = (fileName: string): void => {
    const path = index.get(fileName);
    if (!path || visited.has(fileName)) return;
    visited.add(fileName);
    const raw = parseBinding(path);
    if (fileName === 'lcd-controller.yaml') requiresPixelFormat = true;
    for (const [prop, info] of raw.required) {
      const prev = required.get(prop);
      required.set(prop, {
        type: info.type ?? prev?.type,
        default: info.default ?? prev?.default,
      });
    }
    for (const inc of raw.includes) load(inc);
  };
  const noteProps = (fileName: string): void => {
    const path = index.get(fileName);
    if (!path) return;
    const raw = parseBinding(path);
    for (const p of raw.props) props.add(p);
    for (const inc of raw.includes) noteProps(inc);
  };

  // Find the binding whose declared compatible matches.
  for (const [fileName, path] of index) {
    if (!fileName.includes(',')) continue; // compatibles are vendor,name.yaml
    const raw = parseBinding(path);
    if (raw.compatible === compatible) {
      load(fileName);
      noteProps(fileName);
      return { compatible, required, requiresPixelFormat, props };
    }
  }
  return undefined;
}

/** All display-panel compatibles with bindings in the tree (for mount
 *  validation: ui.mount accepts any of these driver strings). */
export function listBoundDisplayCompatibles(): string[] {
  const root = findZephyrBase();
  if (!root) return [];
  const index = bindingIndex(root);
  const out: string[] = [];
  for (const [fileName, path] of index) {
    if (!fileName.includes(',')) continue; // compatibles are vendor,name.yaml
    // Panel bindings live under dts/bindings/display/ — match the path
    // segment, not the filename (compatibles don't contain "display").
    const normalized = path.replace(/\\/g, '/');
    if (!/\/bindings\/display\//.test(normalized)) continue;
    const raw = parseBinding(path);
    if (raw.compatible) out.push(raw.compatible);
  }
  return out.sort();
}
