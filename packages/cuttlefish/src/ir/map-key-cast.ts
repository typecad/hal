// ---------------------------------------------------------------------------
// Map key enum casting — ONE implementation of the "an enum-typed key must
// cast to the container's key type" rule, shared by every lowering site.
//
// This used to exist as two diverged copies (an inline `keyIsEnum` block in
// expression-to-ir's Map-method lowering and `castEnumKeyIfNeeded` in
// call-statement.ts) plus a third partial copy in the `??` nullish lowering.
// They disagreed on coverage — the statement-path copy accepted only integral
// key types, so a `Map<number, V>` (a std::map<double,…>) never cast its enum
// keys and emitted `m[Verb::Dump]`, which a scoped enum cannot convert to
// (bench-supervisor demo). All three now consult this function, which covers:
//   - enum member accesses (`Verb.Dump`),
//   - bare enum-typed identifiers (`k` where `k: Verb`), and
//   - enum-typed instance FIELDS (`cmd.verb` — Command::verb is a scoped
//     enum), resolved through the class registry.
// ---------------------------------------------------------------------------

import ts from "typescript";
import { activeEnumNames, activeStringEnumNames } from "./build-ir-state.js";
import { getCurrentIrTypeScope } from "./symbol-types.js";
import { parseCppType, renderCppType, parsedIsMap, parsedIsSet } from "../api/shared/cpp-type-ir.js";

/** Key types an enum converts to only via static_cast (a scoped enum has no
 *  implicit conversion to any of these — double/float included, which
 *  `Map<number, V>` produces). */
const ENUM_CASTABLE_KEY_RE = /^(int|int8_t|int16_t|int32_t|int64_t|uint8_t|uint16_t|uint32_t|uint64_t|size_t|long|short|unsigned|char|double|float)$/;

/** The C++ key type of a map/set receiver, or "" when not a container. */
export function mapKeyTypeOf(receiverType: string): string {
  if (!parsedIsMap(receiverType) && !parsedIsSet(receiverType)) return "";
  const ir = parseCppType(receiverType);
  return ir.kind === "map" ? renderCppType(ir.key) : "";
}

/** True when the key NODE is enum-typed (member access, bare identifier, or
 *  enum-typed instance field). */
export function mapKeyNodeIsEnum(keyNode: ts.Expression, resolveFieldType?: (node: ts.Expression) => string | undefined): boolean {
  if (ts.isPropertyAccessExpression(keyNode) && ts.isIdentifier(keyNode.expression)) {
    // Enum member access: `Color.Red`.
    if (activeEnumNames.has(keyNode.expression.text)) return true;
  }
  if (ts.isIdentifier(keyNode)) {
    // Bare identifier: its declared type is an enum.
    const varType = getCurrentIrTypeScope()?.locals.get(keyNode.text)
      ?? getCurrentIrTypeScope()?.globals.get(keyNode.text);
    if (varType && activeEnumNames.has(varType) && !activeStringEnumNames.has(varType)) {
      return true;
    }
    return false;
  }
  // An enum-typed FIELD on an instance (`cmd.verb` — Command::verb): resolve
  // the property access's type through the caller's class-registry resolver
  // (expression-to-ir's resolveExprCppType).
  if (ts.isPropertyAccessExpression(keyNode) && resolveFieldType) {
    const t = resolveFieldType(keyNode);
    return !!t && activeEnumNames.has(t) && !activeStringEnumNames.has(t);
  }
  return false;
}

/** Wrap `keyText` in `static_cast<KeyType>(...)` when the key node is
 *  enum-typed and the container's key type requires it; passthrough
 *  otherwise. `resolveFieldType` lets the caller supply its class-registry
 *  resolver for the enum-field shape. */
export function castMapKeyIfNeeded(
  keyText: string,
  keyNode: ts.Expression,
  receiverType: string,
  resolveFieldType?: (node: ts.Expression) => string | undefined,
): string {
  const keyType = mapKeyTypeOf(receiverType);
  if (!keyType || !ENUM_CASTABLE_KEY_RE.test(keyType)) return keyText;
  if (!mapKeyNodeIsEnum(keyNode, resolveFieldType)) return keyText;
  return `static_cast<${keyType}>(${keyText})`;
}
