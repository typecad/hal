TypeCAD Runtime Exception
Copyright (c) 2026 typecad0

================================================================================
Purpose
================================================================================

TypeCAD is a TypeScript-to-C++ transpiler. The transpiler writes C and C++
source text into files that belong to the end user — the generated .cpp / .h
files that get compiled into firmware binaries and flashed to devices.

This file grants an additional permission (a "runtime exception") so that the
license of the transpiler tool itself can never contaminate the code it emits
into user output. Without this carve-out, a future change of the tool's license
(for example, to a copyleft license) could force every user's shipped firmware
to inherit that license — which would make TypeCAD unusable for anyone shipping
a closed device.

This is the same model used by GCC, LLVM/Clang, and the Rust compiler: the
compiler can be licensed however its authors choose, but the bytes it writes
into your program are yours and stay license-free of the compiler.

================================================================================
The grant
================================================================================

Notwithstanding any other term of the license under which the TypeCAD source
code is distributed, typecad0 grants you the additional permission to use, copy,
modify, merge, publish, distribute, sublicense, and sell, in source or binary
form, any output file produced by running the TypeCAD transpiler, without any
obligation arising from the license of the transpiler source code.

In other words: the license of packages/cuttlefish, packages/hal, the
framework packages, and packages/ui imposes no restriction on the generated
files, headers, and firmware binaries you produce with them.

================================================================================
The emit boundary — what the exception covers
================================================================================

The exception applies only to code that TypeCAD writes into your output files
(the "emit boundary"). The tool source itself is unaffected; it remains under
whatever license is stated in its package.

The emit boundary consists of three surfaces, all of which produce text that
lands in user .cpp / .h files:

  (A) HAL lowering
      The framework strategies translate HAL semantic calls into framework-
      specific C++. Entered via:
        packages/hal/src/emit.ts
        packages/framework-*/src/lowering/*.ts   (e.g. fs.ts, gpio.ts,
                                                  mqtt.ts, random.ts, wifi.ts)

  (B) Framework strategy / scaffold
      Entrypoint scaffolds, devicetree/Kconfig synthesis, and peripheral
      adapters. Entered via:
        packages/framework-zephyr/src/strategy.ts
        packages/cuttlefish/src/frameworks/native/strategy.ts

  (C) UI runtime header
      The C++ runtime header assembled from the partial emitters in:
        packages/ui/src/ui-engine/runtime-header/*.ts
      (e.g. cuttlefish-gfx.ts, display-shim.ts, scroll-physics.ts,
      text-rendering.ts, and the structural head forward-decls.ts)

If TypeCAD grows new emit surfaces, they are covered by this exception if and
only if they write text into user output files. Code that runs only inside the
transpiler process (parsing, IR transforms, diagnostics) is not part of the
emit boundary and is not covered.

================================================================================
What this exception does NOT change
================================================================================

1. Third-party code emitted into output files keeps its upstream license.
   Some emit-boundary code is ported or transcribed from third-party sources
   (Adafruit_GFX geometry, the glcdfont table, touch register protocols). This exception grants no rights you do not already have
   under those upstream licenses; their obligations travel with the emitted
   bytes. See NOTICE for the itemized third-party attributions and their
   BSD-3-Clause terms.

2. Linked libraries are unaffected. The Zephyr framework links the Zephyr
   kernel and vendor HAL libraries at compile time rather than emitting their
   source. End users retain their own license obligations to those libraries;
   this exception says nothing about them.

3. The transpiler source code is not re-licensed by this file. Every package's
   license field in its package.json continues to govern the source of the tool
   itself.

================================================================================
Survival
================================================================================

This additional permission is irrevocable and survives any future change to the
license of the TypeCAD source code. If the tool source is ever moved to a more
restrictive license (copyleft, source-available, or commercial), the emit
boundary defined above remains permanently free of that restriction, exactly as
stated here.

The intent is that you can adopt TypeCAD today knowing your generated firmware
will never become subject to a tool-license obligation you did not agree to,
regardless of how TypeCAD itself is licensed in the future.
