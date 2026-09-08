// ---------------------------------------------------------------------------
// @typecad/hal — Project configuration types
//
// The one type users write in a typecad-hal.config.ts:
//
//   import type { TypecadConfig } from '@typecad/hal/config';
//
// The specifier is a subpath on purpose: the project tsconfig maps the exact
// '@typecad/hal' specifier onto the generated board module (.typecad-hal/
// board.ts), and only subpaths (like this one and './core') fall through to
// the real package. The type itself is authored in the engine (which
// validates it with zod at load time); hal re-exports it so user configs
// never reference the engine package.
// ---------------------------------------------------------------------------

export type { TypecadConfig } from '@typecad/cuttlefish/api';
