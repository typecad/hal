import { describe, it, expect, afterEach } from "vitest";
import {
  identifySpdx,
  classifyRisk,
  scanLicenses,
  coerceLibList,
  __setLicensesRunnerForTest,
  type ScanOptions,
} from "../../../packages/cuttlefish/src/licenses";

describe("identifySpdx — alias matching (short library.properties values)", () => {
  it("matches canonical SPDX IDs", () => {
    expect(identifySpdx("MIT")).toBe("MIT");
    expect(identifySpdx("Apache-2.0")).toBe("Apache-2.0");
    expect(identifySpdx("BSD-3-Clause")).toBe("BSD-3-Clause");
    expect(identifySpdx("GPL-3.0")).toBe("GPL-3.0");
    expect(identifySpdx("LGPL-2.1")).toBe("LGPL-2.1");
  });

  it("matches common aliases case-insensitively", () => {
    expect(identifySpdx("apache 2.0")).toBe("Apache-2.0");
    expect(identifySpdx("BSD")).toBe("BSD-3-Clause");
    expect(identifySpdx("GPLv3")).toBe("GPL-3.0");
  });

  it("returns undefined for an unrecognized string", () => {
    expect(identifySpdx("some-custom-license")).toBeUndefined();
  });
});

describe("identifySpdx — full LICENSE file content", () => {
  it("honors an SPDX-License-Identifier marker when present", () => {
    const text = "SPDX-License-Identifier: LGPL-2.1\n\nSome header text.";
    expect(identifySpdx(text)).toBe("LGPL-2.1");
  });

  it("matches the MIT marker phrase in a full license body", () => {
    const text =
      "The MIT License (MIT)\n\n" +
      "Permission is hereby granted, free of charge, to any person obtaining a copy of this software";
    expect(identifySpdx(text)).toBe("MIT");
  });

  it("matches BSD-3 via the 'neither the name' body clause", () => {
    const text =
      "Redistribution and use in source and binary forms, with or without modification,\n" +
      "are permitted provided that the following conditions are met:\n" +
      "Redistributions of source code must retain the above copyright notice.\n" +
      "Redistributions in binary form must reproduce the above copyright notice.\n" +
      "Neither the name of the copyright holder nor the names of its contributors may be used";
    expect(identifySpdx(text)).toBe("BSD-3-Clause");
  });

  it("returns undefined for a license body that matches nothing", () => {
    expect(identifySpdx("This is some weird proprietary text with no known markers.")).toBeUndefined();
  });
});

describe("classifyRisk", () => {
  it("classifies permissive licenses", () => {
    expect(classifyRisk("MIT")).toBe("permissive");
    expect(classifyRisk("BSD-3-Clause")).toBe("permissive");
    expect(classifyRisk("Apache-2.0")).toBe("permissive");
  });

  it("classifies weak copyleft", () => {
    expect(classifyRisk("LGPL-2.1")).toBe("weak-copyleft");
    expect(classifyRisk("LGPL-3.0")).toBe("weak-copyleft");
  });

  it("classifies strong copyleft", () => {
    expect(classifyRisk("GPL-2.0")).toBe("strong-copyleft");
    expect(classifyRisk("GPL-3.0")).toBe("strong-copyleft");
    expect(classifyRisk("AGPL-3.0")).toBe("strong-copyleft");
  });

  it("returns unknown for unrecognized ids", () => {
    expect(classifyRisk("Made-Up-License")).toBe("unknown");
  });
});

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
