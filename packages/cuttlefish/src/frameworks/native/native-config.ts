// ---------------------------------------------------------------------------
// Native C++ compilation configuration
//
// Place under the `native` key in TypeCAD.config.ts to customize
// how g++/clang++ compiles your generated C++ code.
// ---------------------------------------------------------------------------

/**
 * Native C++ compilation configuration.
 *
 * @example
 * ```ts
 * // TypeCAD.config.ts
 * const config: TypeCADConfig = {
 *   framework: '@typecad/framework-native',
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
  /**
   * Libraries to link (-l flags, without the 'lib' prefix).
   *
   * Note: when the `sdl` display driver is active, SDL2 link libraries are
   * auto-provided per platform by NativeToolchain (-lmingw32 -lSDL2main -lSDL2
   * on Windows, -lSDL2 elsewhere); this field is for additional user libraries
   * and is appended (deduped) after the auto-provided set.
   */
  libraries?: string[];
  /** Warning level: 'none', 'basic', 'all', 'extra', 'error'. Default: 'basic'. */
  warnings?: string;
  /** Static linking toggle. Default: true on Windows, false elsewhere. */
  staticLink?: boolean;
}
