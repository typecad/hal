// ---------------------------------------------------------------------------
// SymbolTable — the single ProgramIR-derived aggregation of cross-file type
// facts consumed by the emit phase.
//
// Phase 2 of the type-resolution consolidation. Previously the cross-file
// aggregation lived as hand-rolled ad-hoc loops in transpile.ts (the ~90-line
// block that built allClassFieldTypes / allClassAccessors /
// allFunctionReturnTypes / allVariableTypes / allClassNames) and was then
// duplicated again, per-file, in emit/emitters/setup.ts. This module is the
// canonical extraction of that aggregation: buildSymbolTable walks one
// ProgramIR, mergeSymbolTables folds many into the cross-module view, and the
// resulting SymbolTable projects onto the existing crossModule* emitter
// options without changing their shape (so renderers and EmitterContext fields
// are untouched).
//
// The construction rules here mirror the old transpile.ts block EXACTLY —
// including the two-pass extendsClass inheritance (own fields first, then a
// second pass that copies missing parent fields into children) — so emitted
// C++ is byte-identical. See the approved plan's Phase 2 risk note.
// ---------------------------------------------------------------------------

import type { ProgramIR } from "../api/index.js";

/**
 * Per-class accessor map: member name → whether it is a getter, setter, or
 * both. Keyed by class name, matching the old allClassAccessors shape.
 */
export type ClassAccessors = Map<string, "getter" | "setter" | "both">;

export interface SymbolTable {
  /** className/interfaceName → fieldName → cppType. Replaces allClassFieldTypes
   *  and the per-file interfaceFieldTypes cross-module portion. Includes
   *  extendsClass-inherited fields once resolveInheritance runs. */
  classFieldTypes: Map<string, Map<string, string>>;
  /** className → accessor map. Replaces allClassAccessors. */
  classAccessors: Map<string, ClassAccessors>;
  /** function name → return cppType. Replaces allFunctionReturnTypes. */
  functionReturnTypes: Map<string, string>;
  /** top-level variable name → cppType (non-"auto" only). Replaces
   *  allVariableTypes. */
  variableTypes: Map<string, string>;
  /** All class names across the aggregated files. Replaces allClassNames. */
  classNames: Set<string>;
  /** className → parent class name (the `extends X` target). Needed by
   *  resolveInheritance to copy parent fields into children; not present in
   *  the old ad-hoc maps (it was read from programIR.classes in the second
   *  pass) so it is retained here to keep inheritance resolvable from the
   *  aggregated table alone. */
  extends: Map<string, string>;
}

export function createSymbolTable(): SymbolTable {
  return {
    classFieldTypes: new Map(),
    classAccessors: new Map(),
    functionReturnTypes: new Map(),
    variableTypes: new Map(),
    classNames: new Set(),
    extends: new Map(),
  };
}

/**
 * Build a SymbolTable from a single file's ProgramIR. This is the per-file
 * view; cross-file aggregation is done by mergeSymbolTable.
 *
 * Mirrors the old transpile.ts:612-666 first pass:
 *   - class fields, interface fields, accessors, function return types, and
 *     non-"auto" top-level variable types are collected
 *   - extendsClass relationships are recorded for the post-merge inheritance
 *     pass (the old code read them from programIR.classes directly)
 * Accessor kind merge rule: getter+setter on the same name → "both".
 *
 * Does NOT fold parent fields into children yet — that happens once, after
 * all files are merged, in resolveInheritance (mirroring the old two-pass
 * structure where the second pass ran after the first pass over all files).
 */
export function buildSymbolTable(program: ProgramIR): SymbolTable {
  const table = createSymbolTable();

  for (const cls of program.classes) {
    table.classNames.add(cls.name);

    if (cls.fields.length > 0 || cls.extendsClass) {
      const fieldTypes = table.classFieldTypes.get(cls.name) ?? new Map<string, string>();
      for (const field of cls.fields) {
        fieldTypes.set(field.name, field.cppType);
      }
      table.classFieldTypes.set(cls.name, fieldTypes);
    }

    if (cls.extendsClass) {
      // NOTE: the old transpile.ts code used the RAW extendsClass string
      // (including any template args, e.g. "Generic<std::string>") as the key
      // into the field-type map — which is keyed by bare class names. Such a
      // lookup silently fails for generic parents (no field entry under
      // "Generic<std::string>"), so inheritance doesn't apply. We preserve
      // that exact behavior here for byte-identical output rather than
      // stripping template args (which would be "more correct" but would
      // change which fields get inherited and thus the emitted C++).
      table.extends.set(cls.name, cls.extendsClass);
    }

    if (cls.getters.length > 0 || cls.setters.length > 0) {
      const accessors = table.classAccessors.get(cls.name) ?? new Map<string, "getter" | "setter" | "both">();
      for (const g of cls.getters) accessors.set(g.name, accessors.has(g.name) ? "both" : "getter");
      for (const s of cls.setters) accessors.set(s.name, accessors.has(s.name) ? "both" : "setter");
      table.classAccessors.set(cls.name, accessors);
    }
  }

  // Interfaces lower to C++ structs, so their fields must be visible
  // cross-module for type-driven emit decisions. Mirrors the old
  // transpile.ts:650-658 interface aggregation.
  for (const iface of program.interfaces) {
    if (iface.fields.length > 0) {
      const fieldTypes = table.classFieldTypes.get(iface.name) ?? new Map<string, string>();
      for (const field of iface.fields) {
        fieldTypes.set(field.name, field.cppType);
      }
      table.classFieldTypes.set(iface.name, fieldTypes);
    }
  }

  for (const fn of program.functions) {
    table.functionReturnTypes.set(fn.originalName, fn.returnType);
  }

  for (const stmt of program.topLevelStatements) {
    if (stmt.kind === "var_decl" && stmt.cppType !== "auto") {
      table.variableTypes.set(stmt.name, stmt.cppType);
    }
  }

  return table;
}

/**
 * Fold one SymbolTable into an accumulating cross-module table. This is the
 * merge used during Pass 1 of transpile.ts to build the cross-file view from
 * every file's per-file table.
 *
 * Field-type and accessor entries are merged (later files add to existing
 * class entries); function return types and variable types are last-write-wins
 * (matching the old Map.set behavior); class names are unioned; extends
 * relationships are last-write-wins.
 */
export function mergeSymbolTable(target: SymbolTable, source: SymbolTable): SymbolTable {
  for (const [className, fieldTypes] of source.classFieldTypes) {
    const existing = target.classFieldTypes.get(className) ?? new Map<string, string>();
    for (const [fname, ftype] of fieldTypes) {
      existing.set(fname, ftype);
    }
    target.classFieldTypes.set(className, existing);
  }
  for (const [className, accessors] of source.classAccessors) {
    const existing = target.classAccessors.get(className) ?? new Map<string, "getter" | "setter" | "both">();
    for (const [member, kind] of accessors) {
      // Mirror buildSymbolTable's merge rule: if both getter and setter exist
      // across the merge, the result is "both".
      const prev = existing.get(member);
      if (prev && prev !== kind) {
        existing.set(member, "both");
      } else {
        existing.set(member, kind);
      }
    }
    target.classAccessors.set(className, existing);
  }
  for (const [fnName, retType] of source.functionReturnTypes) {
    target.functionReturnTypes.set(fnName, retType);
  }
  for (const [varName, varType] of source.variableTypes) {
    target.variableTypes.set(varName, varType);
  }
  for (const [child, parent] of source.extends) {
    target.extends.set(child, parent);
  }
  for (const name of source.classNames) {
    target.classNames.add(name);
  }
  return target;
}

/**
 * Apply extendsClass field inheritance across an aggregated SymbolTable.
 * Mirrors the old transpile.ts:668-688 SECOND pass: for each class that
 * extends a parent present in the table, copy any parent fields the child does
 * not already declare. Must run AFTER all files have been merged so cross-file
 * parents are visible.
 *
 * Merge rule (preserved exactly): `!childFields.has(fname)` — a child's own
 * field declaration wins over the parent's. If the child has no field entry at
 * all but the parent does, a fresh entry seeded entirely from the parent is
 * created (mirroring the old `else if (parentFields && !childFields)` branch).
 */
export function resolveInheritance(table: SymbolTable): void {
  for (const [childName, parentName] of table.extends) {
    const parentFields = table.classFieldTypes.get(parentName);
    if (!parentFields) continue;
    const childFields = table.classFieldTypes.get(childName);
    if (childFields) {
      for (const [fname, ftype] of parentFields) {
        if (!childFields.has(fname)) {
          childFields.set(fname, ftype);
        }
      }
    } else {
      const fieldTypes = new Map<string, string>();
      for (const [fname, ftype] of parentFields) {
        fieldTypes.set(fname, ftype);
      }
      table.classFieldTypes.set(childName, fieldTypes);
    }
  }
}
