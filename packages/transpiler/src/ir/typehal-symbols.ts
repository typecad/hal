// ---------------------------------------------------------------------------
// TypeHAL SDK symbol kind inference (transpiler re-export)
//
// Re-exports from @typehal/core/shared. Symbol registrations happen in
// board and framework packages.
// ---------------------------------------------------------------------------

export type { TypehalReceiverKind } from "@typehal/core/shared";
export { inferKindByName, registerSymbolKinds, pinsWithKind } from "@typehal/core/shared";
