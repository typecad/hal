/** Compile-time function: registers a function argument as a standalone C++ callback.
 *  Returns the generated function name for use in rawCpp() templates. */
export declare function callback<T extends (...args: any[]) => any>(fn: T): string;
