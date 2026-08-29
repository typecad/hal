/** Determine the ASIL level of a function from its decorators.
 *  Returns a numeric severity: D=4, C=3, B=2, A=1, QM/none=0.
 *  Higher = more rules enforced. */
export function asilLevel(decorators?: string[]): number {
  if (!decorators) return 0;
  if (decorators.includes("asilD")) return 4;
  if (decorators.includes("asilC")) return 3;
  if (decorators.includes("asilB")) return 2;
  if (decorators.includes("asilA")) return 1;
  return 0;
}

/** Minimum ASIL level at which each rule applies. */
export const ASIL_THRESHOLDS = {
  recursion: 2,   // B+ — recursion forbidden
  dynamicAlloc: 4, // D only — heap forbidden after init
  unboundedLoop: 3, // C+ — unbounded loops warned
} as const;
