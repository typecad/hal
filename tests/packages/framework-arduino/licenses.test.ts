import { describe, it, expect, afterEach } from "vitest";
import {
  scanLicenses,
  coerceLibList,
  resolveProjectHeaders,
  joinHeadersToLibraries,
  isToolchainHeader,
  resolveProjectCore,
  buildCoreHeaderIndex,
  __setLicensesRunnerForTest,
  type ScanOptions,
} from "../../../packages/framework-arduino/src/licenses";

// NOTE: identifySpdx / classifyRisk now live in the shared cuttlefish core and
// are covered by tests/packages/cuttlefish/spdx-licenses.test.ts. This file
// covers the Arduino-specific enumeration + project-scope resolution only.

// ---- scanLicenses fixtures ----

function makeOpts(
  libs: unknown[] | null,
  readFile: (p: string) => string | undefined,
  readdir: (d: string) => string[] = () => [],
): ScanOptions {
  return {
    fakeLibList: () => libs as any,
    fakeReadFile: readFile,
    fakeReaddir: readdir,
  };
}

describe("scanLicenses — enumeration failure modes", () => {
  it("fails with arduino-cli-unresponsive when lib list returns null", () => {
    const result = scanLicenses(makeOpts(null, () => undefined));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("arduino-cli-unresponsive");
    }
  });

  it("fails with no-libraries when the list is empty", () => {
    const result = scanLicenses(makeOpts([], () => undefined));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("no-libraries");
    }
  });
});

describe("scanLicenses — per-library resolution priority", () => {
  it("prefers library.properties license= over a LICENSE file", () => {
    const result = scanLicenses(
      makeOpts(
        [{ name: "L", install_dir: "/L" }],
        (p) => {
          if (p.endsWith("library.properties")) return "license=MIT\nname=L\n";
          if (p.endsWith("LICENSE")) return "BSD 3-Clause text...";
          return undefined;
        },
        () => ["library.properties", "LICENSE"],
      ),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.libraries[0].spdx).toBe("MIT");
      expect(result.libraries[0].source).toBe("library.properties");
    }
  });

  it("falls back to the LICENSE file when properties omits license", () => {
    const result = scanLicenses(
      makeOpts(
        [{ name: "L", install_dir: "/L" }],
        (p) => {
          if (p.endsWith("library.properties")) return "name=L\n";
          if (p.endsWith("LICENSE")) return "Apache License\nVersion 2.0";
          return undefined;
        },
        () => ["library.properties", "LICENSE"],
      ),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.libraries[0].spdx).toBe("Apache-2.0");
      expect(result.libraries[0].source).toBe("license-file");
    }
  });

  it("marks unknown when neither properties nor a LICENSE file resolves", () => {
    const result = scanLicenses(
      makeOpts(
        [{ name: "L", install_dir: "/L" }],
        () => undefined,
      ),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.libraries[0].spdx).toBeUndefined();
      expect(result.libraries[0].risk).toBe("unknown");
      expect(result.libraries[0].source).toBe("none");
    }
  });
});

describe("scanLicenses — British LICENCE.txt spelling (lvgl pattern)", () => {
  it("finds a license in LICENCE.txt (British spelling)", () => {
    const result = scanLicenses({
      fakeLibList: () => [{ name: "lvgl", install_dir: "/lvgl" }],
      fakeReadFile: (p) =>
        p.endsWith("LICENCE.txt")
          ? "MIT licence\nCopyright (c) 2025\n\nPermission is hereby granted, free of charge"
          : undefined,
      fakeReaddir: (d) => (d === "/lvgl" ? ["LICENCE.txt"] : []),
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.libraries[0].spdx).toBe("MIT");
      expect(result.libraries[0].source).toBe("license-file");
    }
  });
});

describe("scanLicenses — LICENSE file in src/ subdir (Arduino convention)", () => {
  it("finds a LICENSE file under src/ when none is in the root", () => {
    const result = scanLicenses({
      fakeLibList: () => [{ name: "L", install_dir: "/L" }],
      // Match by basename so the test is path-separator-agnostic (path.join
      // uses \ on Windows).
      fakeReadFile: (p) =>
        p.endsWith("LICENSE") && p.includes("src") ? "Apache License\nVersion 2.0" : undefined,
      fakeReaddir: (d) => (d.endsWith("L") && !d.includes("src") ? ["src"] : d.includes("src") ? ["LICENSE"] : []),
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.libraries[0].spdx).toBe("Apache-2.0");
      expect(result.libraries[0].source).toBe("license-file");
    }
  });
});

describe("scanLicenses — source header comments when no LICENSE file (Adafruit pattern)", () => {
  it("reads 'BSD license' from a .h header comment and classifies BSD-3", () => {
    const header =
      "/*! @file Adafruit_ILI9341.h\n" +
      " * Written by Limor Fried for Adafruit Industries.\n" +
      " *\n" +
      " * BSD license, all text here must be included in any redistribution.\n" +
      " */\n" +
      "#ifndef _ADAFRUIT_ILI9341H_\n";
    const result = scanLicenses({
      fakeLibList: () => [{ name: "Adafruit_ILI9341", install_dir: "/ILI9341" }],
      fakeReadFile: (p) => (p.endsWith("Adafruit_ILI9341.h") ? header : undefined),
      fakeReaddir: (d) => (d === "/ILI9341" ? ["Adafruit_ILI9341.h", "library.properties"] : []),
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.libraries[0].spdx).toBe("BSD-3-Clause");
      expect(result.libraries[0].source).toBe("source-header");
    }
  });

  it("reads a full MIT notice from a .h header when no LICENSE file exists", () => {
    const header =
      "/* Touchscreen library\n" +
      " * Copyright (c) 2015, Paul Stoffregen\n" +
      " *\n" +
      " * Permission is hereby granted, free of charge, to any person obtaining a copy\n" +
      " * of this software and associated documentation files (the \"Software\"), to deal\n" +
      " */\n";
    const result = scanLicenses({
      fakeLibList: () => [{ name: "XPT2046_Touchscreen", install_dir: "/XPT" }],
      fakeReadFile: (p) => (p.endsWith("XPT2046_Touchscreen.h") ? header : undefined),
      fakeReaddir: (d) => (d === "/XPT" ? ["XPT2046_Touchscreen.h"] : []),
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.libraries[0].spdx).toBe("MIT");
      expect(result.libraries[0].source).toBe("source-header");
    }
  });

  it("reads 'Apache License, version 2.0' from a header comment", () => {
    const header =
      "// ArduinoHttpClient\n" +
      "// Released under Apache License, version 2.0\n";
    const result = scanLicenses({
      fakeLibList: () => [{ name: "ArduinoHttpClient", install_dir: "/AHC" }],
      fakeReadFile: (p) => (p.endsWith("HttpClient.h") ? header : undefined),
      // Separator-agnostic: root lists "src", the src dir lists the header.
      fakeReaddir: (d) =>
        d.endsWith("AHC") && !d.includes("src") ? ["src"] : d.includes("src") ? ["HttpClient.h"] : [],
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.libraries[0].spdx).toBe("Apache-2.0");
      expect(result.libraries[0].source).toBe("source-header");
    }
  });

  it("still falls to unknown when the header has no recognizable license text", () => {
    const header = "#pragma once\n#include \"Arduino.h\"\n";
    const result = scanLicenses({
      fakeLibList: () => [{ name: "NTPClient", install_dir: "/NTP" }],
      fakeReadFile: (p) => (p.endsWith("NTPClient.h") ? header : undefined),
      fakeReaddir: (d) => (d === "/NTP" ? ["NTPClient.h"] : []),
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.libraries[0].spdx).toBeUndefined();
      expect(result.libraries[0].risk).toBe("unknown");
    }
  });
});

describe("coerceLibList — dual arduino-cli JSON shape", () => {
  it("parses the newer wrapped shape", () => {
    // `coerceLibList` is tested directly because fakeLibList returns the
    // already-flat list; the dual-shape parsing lives in coerceLibList.
    const wrapped = { installed_libraries: [{ library: { name: "X", install_dir: "/X" } }] };
    expect(coerceLibList(wrapped).map((l) => l.name)).toEqual(["X"]);
  });

  it("parses the legacy bare-array shape", () => {
    const bare = [{ name: "Y", version: "1.0", install_dir: "/Y" }];
    expect(coerceLibList(bare).map((l) => l.name)).toEqual(["Y"]);
  });

  it("returns [] for an unrecognized shape", () => {
    expect(coerceLibList({ weird: true })).toEqual([]);
    expect(coerceLibList("string")).toEqual([]);
    expect(coerceLibList(null)).toEqual([]);
  });
});

describe("scanLicenses — sort order (strong → weak → permissive → unknown)", () => {
  it("returns libraries sorted worst-first", () => {
    const libs = [
      { name: "MITLib", install_dir: "/MITLib" },
      { name: "GPLLib", install_dir: "/GPLLib" },
      { name: "UnknownLib", install_dir: "/UnknownLib" },
      { name: "LGSDLib", install_dir: "/LGSDLib" },
    ];
    const readFile = (p: string): string | undefined => {
      if (p === "/MITLib/library.properties") return "license=MIT\n";
      if (p === "/GPLLib/library.properties") return "license=GPL-3.0\n";
      if (p === "/LGSDLib/library.properties") return "license=LGPL-2.1\n";
      return undefined;
    };
    const result = scanLicenses(makeOpts(libs as any[], readFile));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.libraries.map((l) => l.name)).toEqual([
        "GPLLib", // strong-copyleft
        "LGSDLib", // weak-copyleft
        "MITLib", // permissive
        "UnknownLib", // unknown
      ]);
    }
  });
});

describe("scanLicenses — module-level test override", () => {
  afterEach(() => __setLicensesRunnerForTest(undefined));

  it("uses the injected runner when no inline options are passed", () => {
    __setLicensesRunnerForTest({
      listLibraries: () => [{ name: "X", install_dir: "/X" }],
      readFile: () => undefined,
      readdir: () => [],
    });
    const result = scanLicenses();
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.libraries[0].name).toBe("X");
  });

  it("inline options take precedence over the module override", () => {
    __setLicensesRunnerForTest({
      listLibraries: () => [{ name: "MODULE", install_dir: "/MODULE" }],
      readFile: () => undefined,
      readdir: () => [],
    });
    const result = scanLicenses({ fakeLibList: () => [{ name: "INLINE", install_dir: "/INLINE" }] });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.libraries[0].name).toBe("INLINE");
  });
});

describe("resolveProjectHeaders — .ino parsing", () => {
  const denylist = ["Arduino.h", "stdio.h", "stdint.h", "stdlib.h", "string.h", "Esp.h", "math.h"];

  it("extracts library headers from a .ino and drops system headers", () => {
    const ino =
      "#include <Adafruit_GFX.h>\n" +
      "#include <Adafruit_ILI9341.h>\n" +
      "#include <Arduino.h>\n" +
      "#include <stdio.h>\n" +
      "#include <XPT2046_Touchscreen.h>\n";
    const config = {
      configPath: "/proj/cuttlefish.config.ts",
      entry: "./src/main.ts",
      outputOutDir: "./out",
    };
    const result = resolveProjectHeaders(config as any, (p) => (p.endsWith("main.ino") ? ino : undefined));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.source).toBe("ino");
      expect(result.headers).toEqual(["Adafruit_GFX.h", "Adafruit_ILI9341.h", "XPT2046_Touchscreen.h"]);
    }
  });

  it("excludes every system/stdlib header", () => {
    const ino = denylist.map((h) => `#include <${h}>\n`).join("") + "#include <Wire.h>\n";
    const config = { configPath: "/proj/cuttlefish.config.ts", entry: "./src/main.ts", outputOutDir: "./out" };
    const result = resolveProjectHeaders(config as any, (p) => (p.endsWith("main.ino") ? ino : undefined));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.headers).toEqual(["Wire.h"]);
  });

  it("captures quote includes as well as angle-bracket includes", () => {
    // Arduino libraries may be pulled in via #include "Foo.h".
    const ino = '#include <Adafruit_GFX.h>\n#include "Servo.h"\n';
    const config = { configPath: "/proj/cuttlefish.config.ts", entry: "./src/main.ts", outputOutDir: "./out" };
    const result = resolveProjectHeaders(config as any, (p) => (p.endsWith("main.ino") ? ino : undefined));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.headers).toEqual(["Adafruit_GFX.h", "Servo.h"]);
  });

  it("drops project-local headers co-located with the .ino (not libraries)", () => {
    // A header that lives next to the .ino (e.g. a cuttlefish-emitted polyfill)
    // is project code, not a missing library — it must not be reported.
    const ino = '#include <Adafruit_GFX.h>\n#include "sht30.h"\n';
    const config = { configPath: "/proj/cuttlefish.config.ts", entry: "./src/main.ts", outputOutDir: "./out" };
    // readFile: returns the .ino AND the co-located sht30.h (project-local).
    const result = resolveProjectHeaders(config as any, (p) => {
      if (p.endsWith("main.ino")) return ino;
      if (p.endsWith("sht30.h")) return "// polyfill\n";
      return undefined;
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.headers).toEqual(["Adafruit_GFX.h"]);
  });

  it("returns no-entry when entry is absent and no .ino exists", () => {
    const config = { configPath: "/proj/cuttlefish.config.ts" };
    const result = resolveProjectHeaders(config as any, () => undefined);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("no-entry");
  });
});

describe("resolveProjectHeaders — config fallback (no .ino)", () => {
  it("derives display + touch headers from config when no .ino exists", () => {
    const config = {
      configPath: "/proj/cuttlefish.config.ts",
      entry: "./src/main.ts",
      outputOutDir: "./out",
      display: { driver: "ili9341", touch: { library: "XPT2046_Touchscreen" } },
    };
    const result = resolveProjectHeaders(config as any, () => undefined); // no .ino
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.source).toBe("config");
      expect(result.headers).toContain("Adafruit_GFX.h");
      expect(result.headers).toContain("Adafruit_ILI9341.h");
      expect(result.headers).toContain("XPT2046_Touchscreen.h");
    }
  });

  it("derives display headers without touch", () => {
    const config = {
      configPath: "/proj/cuttlefish.config.ts",
      entry: "./src/main.ts",
      outputOutDir: "./out",
      display: { driver: "st7796" },
    };
    const result = resolveProjectHeaders(config as any, () => undefined);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.headers).toContain("Adafruit_GFX.h");
      expect(result.headers).toContain("Adafruit_ST7796S.h");
    }
  });

  it(".ino is preferred over config when both are available", () => {
    const ino = "#include <Adafruit_GFX.h>\n";
    const config = {
      configPath: "/proj/cuttlefish.config.ts",
      entry: "./src/main.ts",
      outputOutDir: "./out",
      display: { driver: "ili9341" },
    };
    const result = resolveProjectHeaders(config as any, (p) => (p.endsWith("main.ino") ? ino : undefined));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.source).toBe("ino");
  });

  it("returns no-entry when there is no .ino and no display config", () => {
    const config = { configPath: "/proj/cuttlefish.config.ts", entry: "./src/main.ts", outputOutDir: "./out" };
    const result = resolveProjectHeaders(config as any, () => undefined);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("no-entry");
  });
});

describe("joinHeadersToLibraries — header → library filesystem join", () => {
  // Fake installed libraries. Each owns certain headers in its dir.
  const libs = [
    { name: "Adafruit ILI9341", version: "1.6.0", install_dir: "/libs/ILI9341" },
    { name: "Adafruit GFX", version: "1.11.5", install_dir: "/libs/GFX" },
    { name: "ArduinoHttpClient", version: "0.5.0", install_dir: "/libs/AHC" }, // header under src/
  ];

  // readdir: ILI9341 owns Adafruit_ILI9341.h in root; GFX owns Adafruit_GFX.h
  // in root; AHC owns HttpClient.h under src/. Match by trailing path segment
  // so the fixture is path-separator-agnostic (path.join uses \ on Windows).
  const lastSeg = (d: string): string => d.split(/[\\/]/).filter(Boolean).pop() ?? "";
  const readdir = (d: string): string[] => {
    const seg = lastSeg(d);
    // AHC's src/ subdir owns HttpClient.h; gate on the AHC path segment so the
    // non-existent src/ under the other libs' dirs doesn't claim it.
    if (seg === "ILI9341") return ["Adafruit_ILI9341.h", "library.properties"];
    if (seg === "GFX") return ["Adafruit_GFX.h"];
    if (seg === "AHC") return ["src"];
    if (seg === "src" && d.toUpperCase().includes("AHC")) return ["HttpClient.h"];
    return [];
  };
  const readFile = (p: string): string | undefined => {
    if (p.endsWith("library.properties")) return "license=BSD-3-Clause\n";
    return undefined;
  };

  it("resolves a header present in a library's root dir", () => {
    const joined = joinHeadersToLibraries(
      ["Adafruit_ILI9341.h"],
      libs as any,
      readdir,
      readFile,
    );
    expect(joined).toHaveLength(1);
    expect(joined[0].kind).toBe("resolved");
    if (joined[0].kind === "resolved") expect(joined[0].lib.name).toBe("Adafruit ILI9341");
  });

  it("resolves a header only present under a library's src/ dir", () => {
    const joined = joinHeadersToLibraries(["HttpClient.h"], libs as any, readdir, readFile);
    expect(joined[0].kind).toBe("resolved");
    if (joined[0].kind === "resolved") expect(joined[0].lib.name).toBe("ArduinoHttpClient");
  });

  it("marks a header no installed library provides as not-installed", () => {
    const joined = joinHeadersToLibraries(["Adafruit_ST7796S.h"], libs as any, readdir, readFile);
    expect(joined[0].kind).toBe("not-installed");
    if (joined[0].kind === "not-installed") expect(joined[0].header).toBe("Adafruit_ST7796S.h");
  });

  it("returns a mixed list preserving project-header order", () => {
    const joined = joinHeadersToLibraries(
      ["Adafruit_GFX.h", "Adafruit_ST7796S.h", "HttpClient.h"],
      libs as any,
      readdir,
      readFile,
    );
    expect(joined.map((j) => j.kind)).toEqual(["resolved", "not-installed", "resolved"]);
  });
});

describe("isToolchainHeader — toolchain C-library header classifier", () => {
  it("classifies avr-libc avr/*.h headers as toolchain", () => {
    expect(isToolchainHeader("avr/wdt.h")).toBe(true);
    expect(isToolchainHeader("avr/interrupt.h")).toBe(true);
    expect(isToolchainHeader("avr/pgmspace.h")).toBe(true);
    expect(isToolchainHeader("avr/sleep.h")).toBe(true);
  });

  it("classifies avr-libc util/*.h headers as toolchain", () => {
    expect(isToolchainHeader("util/delay.h")).toBe(true);
    expect(isToolchainHeader("util/atomic.h")).toBe(true);
  });

  it("does NOT classify library or core headers as toolchain", () => {
    expect(isToolchainHeader("Wire.h")).toBe(false);
    expect(isToolchainHeader("Adafruit_ILI9341.h")).toBe(false);
    expect(isToolchainHeader("Servo.h")).toBe(false);
    expect(isToolchainHeader("SPI.h")).toBe(false);
  });
});

describe("resolveProjectCore — FQBN to core path", () => {
  // Fake arduino-cli runner returning config dump JSON. The real shape is
  // { config: { directories: { data: "<packagesRoot>" } } }.
  const fakeConfigDump = (dataDir: string) => () =>
    JSON.stringify({ config: { directories: { data: dataDir } } });

  // Match the hardware dir by its trailing path segment so the fixture is
  // separator-agnostic (path.join uses \ on Windows).
  const isHardwareAvrDir = (d: string): boolean => /[/\\]hardware[/\\]avr$/.test(d);

  it("derives the core path from an FQBN and picks the highest installed version", () => {
    // Two versions installed; 1.8.7 > 1.8.6 by semver.
    const readdir = (d: string): string[] => (isHardwareAvrDir(d) ? ["1.8.6", "1.8.7"] : []);
    const result = resolveProjectCore("arduino:avr:uno", fakeConfigDump("/A15"), readdir);
    expect(result.ok).toBe(true);
    if (result.ok) {
      // Normalized to forward slashes for a stable cross-platform assertion.
      const dir = result.coreDir.split("\\").join("/");
      expect(dir).toBe("/A15/packages/arduino/hardware/avr/1.8.7");
    }
  });

  it("falls back to the single available version", () => {
    const readdir = (d: string): string[] => (isHardwareAvrDir(d) ? ["1.8.7"] : []);
    const result = resolveProjectCore("arduino:avr:uno", fakeConfigDump("/A15"), readdir);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.coreDir.split("\\").join("/")).toBe("/A15/packages/arduino/hardware/avr/1.8.7");
  });

  it("returns no-fqbn when the FQBN is absent", () => {
    const result = resolveProjectCore(undefined, fakeConfigDump("/A15"), () => []);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("no-fqbn");
  });

  it("returns no-core when config dump fails (runner returns empty)", () => {
    const result = resolveProjectCore("arduino:avr:uno", () => "", () => []);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("no-core");
  });

  it("returns no-core when the core dir has no versions", () => {
    const readdir = (d: string): string[] => (isHardwareAvrDir(d) ? [] : []);
    const result = resolveProjectCore("arduino:avr:uno", fakeConfigDump("/A15"), readdir);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("no-core");
  });
});

describe("buildCoreHeaderIndex — core bundled-library header index", () => {
  it("indexes headers under <core>/libraries/<Lib>/src/", () => {
    // Core dir layout: libraries/Wire/src/Wire.h, libraries/SPI/src/SPI.h
    // Separator-agnostic matching (path.join uses \ on Windows).
    const lastSeg = (d: string): string => d.split(/[\\/]/).filter(Boolean).pop() ?? "";
    const readdir = (d: string): string[] => {
      const seg = lastSeg(d);
      const parent = d.split(/[\\/]/).filter(Boolean).slice(-2, -1)[0] ?? "";
      if (seg === "core" && parent === "") return ["libraries"];
      if (seg === "libraries" && parent === "core") return ["Wire", "SPI"];
      if (seg === "Wire" && parent === "libraries") return ["src"];
      if (seg === "src" && parent === "Wire") return ["Wire.h", "twi.h"];
      if (seg === "SPI" && parent === "libraries") return ["src"];
      if (seg === "src" && parent === "SPI") return ["SPI.h"];
      return [];
    };
    const index = buildCoreHeaderIndex("/core", readdir);
    expect(index.get("Wire.h")?.name).toBe("Wire");
    expect(index.get("SPI.h")?.name).toBe("SPI");
    // twi.h is an internal header also indexed (first-wins).
    expect(index.get("twi.h")?.name).toBe("Wire");
  });
});

describe("joinHeadersToLibraries — 4-step pipeline (user → core → toolchain → not-installed)", () => {
  // A user library owning Adafruit_ILI9341.h.
  const libs = [{ name: "Adafruit ILI9341", version: "1.6.3", install_dir: "/libs/ILI9341" }];

  // Core dir owning Wire (its header carries an LGPL-2.1 notice).
  const coreDir = "/core";
  const lastSeg = (d: string): string => d.split(/[\\/]/).filter(Boolean).pop() ?? "";
  const parentSeg = (d: string): string => d.split(/[\\/]/).filter(Boolean).slice(-2, -1)[0] ?? "";
  const readdir = (d: string): string[] => {
    const seg = lastSeg(d);
    const parent = parentSeg(d);
    // user lib
    if (seg === "ILI9341" && parent === "libs") return ["Adafruit_ILI9341.h", "library.properties"];
    // core
    if (seg === "core") return ["libraries"];
    if (seg === "libraries" && parent === "core") return ["Wire"];
    if (seg === "Wire" && parent === "libraries") return ["src"];
    if (seg === "src" && parent === "Wire") return ["Wire.h"];
    return [];
  };
  const readFile = (p: string): string | undefined => {
    if (p.endsWith("Adafruit_ILI9341/library.properties")) return "license=BSD-3-Clause\n";
    if (p.endsWith("Wire/src/Wire.h") || p.endsWith("Wire.h")) {
      return (
        "/* TwoWire.h - TWI/I2C library\n" +
        " * This library is free software; you can redistribute it and/or\n" +
        " * modify it under the terms of the GNU Lesser General Public\n" +
        " * License as published by the Free Software Foundation; either\n" +
        " * version 2.1 of the License.\n" +
        " */\n"
      );
    }
    return undefined;
  };

  it("resolves a core-bundled lib header to its license (LGPL-2.1 from the header notice)", () => {
    const joined = joinHeadersToLibraries(["Wire.h"], libs, readdir, readFile, coreDir);
    expect(joined[0].kind).toBe("resolved");
    if (joined[0].kind === "resolved") {
      expect(joined[0].lib.spdx).toBe("LGPL-2.1");
      expect(joined[0].lib.source).toBe("source-header");
    }
  });

  it("classifies a toolchain header as core (not not-installed)", () => {
    const joined = joinHeadersToLibraries(["avr/wdt.h"], libs, readdir, readFile, coreDir);
    expect(joined[0].kind).toBe("core");
    if (joined[0].kind === "core") expect(joined[0].header).toBe("avr/wdt.h");
  });

  it("still resolves a user library header", () => {
    const joined = joinHeadersToLibraries(["Adafruit_ILI9341.h"], libs, readdir, readFile, coreDir);
    expect(joined[0].kind).toBe("resolved");
    if (joined[0].kind === "resolved") expect(joined[0].lib.name).toBe("Adafruit ILI9341");
  });

  it("falls through to not-installed for a genuinely missing header", () => {
    const joined = joinHeadersToLibraries(["Adafruit_ST7796S.h"], libs, readdir, readFile, coreDir);
    expect(joined[0].kind).toBe("not-installed");
  });

  it("returns a mixed list with all four kinds", () => {
    const joined = joinHeadersToLibraries(
      ["Adafruit_ILI9341.h", "Wire.h", "avr/wdt.h", "Adafruit_ST7796S.h"],
      libs,
      readdir,
      readFile,
      coreDir,
    );
    expect(joined.map((j) => j.kind)).toEqual(["resolved", "resolved", "core", "not-installed"]);
  });

  it("skips the core-index step when coreDir is omitted (user → toolchain → not-installed)", () => {
    // No coreDir: Wire.h has no owner and is not a toolchain header → not-installed.
    const joined = joinHeadersToLibraries(["Wire.h", "avr/wdt.h"], libs, readdir, readFile);
    expect(joined.map((j) => j.kind)).toEqual(["not-installed", "core"]);
  });
});
