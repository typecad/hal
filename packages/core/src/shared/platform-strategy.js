"use strict";
// ---------------------------------------------------------------------------
// PlatformStrategy — abstract interface for target-specific C++ emit decisions
//
// Every `target === "arduino"` branch in cpp-emitter.ts is captured here as
// a strategy method.  Board packages provide concrete implementations so the
// emitter stays target-agnostic.
// ---------------------------------------------------------------------------
Object.defineProperty(exports, "__esModule", { value: true });
//# sourceMappingURL=platform-strategy.js.map