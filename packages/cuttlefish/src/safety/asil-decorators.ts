/** ASIL level annotations for functions — comment-based.
 *
 *  ASIL levels are declared via leading comment annotations rather than
 *  TypeScript decorators because:
 *  - TS decorators on function declarations produce TS1206 errors in the
 *    VS Code language server and @typescript-eslint/parser
 *  - Comment annotations work in any editor, any toolchain, without
 *    `experimentalDecorators` or special config
 *
 *  The cuttlefish IR builder extracts these from leading comments via
 *  extractAsilFromComments() in function-builder.ts.
 *
 *  Part B's ISO 26262 checkers (analyzeIR) read the resulting `decorators`
 *  field on FunctionIR to decide which rules to enforce:
 *
 *    // @asilD → all rules enforced (recursion, heap, loops)
 *    // @asilC → recursion + loops enforced (heap is ASIL D only)
 *    // @asilB → recursion enforced
 *    // @asilA → no rules enforced (quality-managed)
 *    (no annotation) → no rules enforced (implicit QM)
 *
 *  Usage:
 *    // @asilD
 *    function engageBrake(): void {
 *      safe.write(brakePin, 1);
 *    }
 *
 *  These are documentation-only exports — they have no runtime behavior
 *  and are never imported by user code. They exist so the ASIL level
 *  names appear in type hints and IDE autocomplete.
 */
