// ---------------------------------------------------------------------------
// Native C++ compilation configuration
//
// Place under the `native` key in typehal.config.ts to customize
// how g++/clang++ compiles your generated C++ code.
// ---------------------------------------------------------------------------

/**
 * Native C++ compilation configuration.
 *
 * @example
 * ```ts
 * // typehal.config.ts
 * const config: TypehalConfig = {
 *   framework: '@typehal/framework-native',
 *   native: {
 *     compiler: 'clang++',
 *     cxxStandard: 'c++20',
 *     warnings: 'extra',
 *     includePaths: ['./vendor/include'],
 *     libraries: ['curl'],
 *   },
 * };
 * ```
 */
export interface NativeCompileConfig {
  /** Override auto-detected compiler (e.g. 'clang++', 'g++-12'). */
  compiler?: string;
  /** C++ standard (e.g. 'c++17', 'c++20'). Default: 'c++17'. */
  cxxStandard?: string;
  /** Additional include directories (-I flags). */
  includePaths?: string[];
  /** Library search directories (-L flags). */
  libraryPaths?: string[];
  /** Libraries to link (-l flags, without the 'lib' prefix). */
  libraries?: string[];
  /** Warning level: 'none', 'basic', 'all', 'extra', 'error'. Default: 'basic'. */
  warnings?: string;
  /** Static linking toggle. Default: true on Windows, false elsewhere. */
  staticLink?: boolean;
}
