/** ISO 26262 ASIL-level decorators for functions and classes.
 *
 *  These are compile-time-only annotations. The cuttlefish transpiler
 *  captures them as decorator names on the FunctionIR/ClassIR nodes
 *  and strips them from emitted C++ (they never appear in the output).
 *
 *  Part B's ISO 26262 checkers (analyzeIR) read these decorators to
 *  decide which rules to enforce on each function:
 *
 *    @asilD → all rules enforced (recursion, heap, loops)
 *    @asilC → recursion + loops enforced (heap is ASIL D only)
 *    @asilB → recursion enforced
 *    @asilA → no rules enforced (quality-managed)
 *    (no decorator) → no rules enforced (QM)
 *
 *  Usage:
 *    import { asilD } from "@typecad/safety";
 *
 *    @asilD
 *    function engageBrake(): void {
 *      safe.write(brakePin, 1);
 *    }
 */

/** ASIL D — highest safety integrity level. All Part B rules enforced. */
export declare function asilD<T>(target: T): T;

/** ASIL C — recursion + unbounded loops enforced. */
export declare function asilC<T>(target: T): T;

/** ASIL B — recursion enforced. */
export declare function asilB<T>(target: T): T;

/** ASIL A — quality-managed, no rules enforced. Explicit marker. */
export declare function asilA<T>(target: T): T;

/** QM — quality-managed, no rules enforced. Explicit marker. */
export declare function asilQM<T>(target: T): T;
