#!/usr/bin/env node
// typecad-hal — the product CLI. The engine (@typecad/cuttlefish) CLI
// self-executes on import with the inherited argv, so forwarding is a bare
// import. This must stay the package's ONLY bin: npx resolves single-bin
// packages by that bin regardless of name (npx @typecad/hal create).
import '@typecad/cuttlefish/cli';
