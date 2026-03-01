import { ExpressionIR } from '../ir/model';
import { TypecodeReceiverKind } from '../ir/typecode-symbols';
import { BoardConstants } from '../ir/board-resolver';
import { TargetProfile } from '../types';
/**
 * Walk a `property-access` IR chain upward and return the parts as a string
 * array, or `undefined` if the chain contains non-identifier/non-property
 * nodes.
 *
 * Example: `Board.definition.memory.flash`
 * → `['Board', 'definition', 'memory', 'flash']`
 */
export declare function extractPropertyChain(expr: ExpressionIR): string[] | undefined;
/**
 * If `chain` is a `Board.definition.*` (or `Pins.definition.*`) path,
 * return the inline C++ literal for that path sourced from the compiled
 * board-definition file constants.
 *
 * Returns `undefined` when no translation is available (e.g. no board
 * constants were resolved, or the path does not exist in the manifest).
 */
export declare function renderBoardDefinitionAccess(chain: string[], target: TargetProfile, boardConstants?: BoardConstants): string | undefined;
/**
 * Translate a typecode method call to an Arduino C++ expression string.
 *
 * @param receiver     Symbol name, e.g. "A0", "D13", "Serial", "I2C0"
 * @param receiverKind Category inferred from the symbol name
 * @param method       Method name called on the receiver
 * @param args         Already-structured ExpressionIR argument list
 * @param renderArg    Callback that renders a single ExpressionIR to a C++ string
 * @returns            The complete C++ expression, or `undefined` if this
 *                     method has no special translation (pass through as-is)
 */
export declare function renderArduinoBuiltin(receiver: string, receiverKind: TypecodeReceiverKind, method: string, args: ReadonlyArray<ExpressionIR>, renderArg: (e: ExpressionIR) => string, boardConstants?: BoardConstants): string | undefined;
/**
 * Try to translate a statement-level typecode callee string (e.g. "D13.high",
 * "Serial.println", "Board.A0.read") to its Arduino C++ equivalent.
 *
 * Returns the complete rendered C++ expression string (without a trailing
 * semicolon), or `undefined` if the callee is not a typecode call.
 */
export declare function tryRenderTypecodeCallStatement(callee: string, args: ReadonlyArray<ExpressionIR>, target: TargetProfile, renderArg: (e: ExpressionIR) => string, boardConstants?: BoardConstants): string | undefined;
//# sourceMappingURL=typecode-map.d.ts.map