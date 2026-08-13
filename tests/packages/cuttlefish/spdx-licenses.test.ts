import { describe, it, expect } from "vitest";
import {
  identifySpdx,
  classifyRisk,
  normalize,
  resolveLibraryLicense,
  readLicenseFile,
  type ReadFile,
  type ReadDir,
} from "../../../packages/cuttlefish/src/api/shared/spdx-licenses";

// ---------------------------------------------------------------------------
// identifySpdx
// ---------------------------------------------------------------------------

describe("identifySpdx — alias matching (short manifest values)", () => {
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

  it("matches Creative Commons SPDX IDs and aliases", () => {
    expect(identifySpdx("CC-BY-4.0")).toBe("CC-BY-4.0");
    expect(identifySpdx("CC-BY-SA-4.0")).toBe("CC-BY-SA-4.0");
    expect(identifySpdx("CC-BY-NC-4.0")).toBe("CC-BY-NC-4.0");
    expect(identifySpdx("Creative Commons Attribution 4.0")).toBe("CC-BY-4.0");
    expect(identifySpdx("cc by-sa 4.0")).toBe("CC-BY-SA-4.0");
  });

  it("matches SPDX -only / -or-later suffixes (used by SPDX-License-Identifier markers)", () => {
    expect(identifySpdx("SPDX-License-Identifier: GPL-3.0-only")).toBe("GPL-3.0");
    expect(identifySpdx("SPDX-License-Identifier: GPL-3.0-or-later")).toBe("GPL-3.0");
    expect(identifySpdx("SPDX-License-Identifier: GPL-2.0-only")).toBe("GPL-2.0");
    expect(identifySpdx("SPDX-License-Identifier: LGPL-2.1-or-later")).toBe("LGPL-2.1");
    expect(identifySpdx("SPDX-License-Identifier: LGPL-3.0-only")).toBe("LGPL-3.0");
    expect(identifySpdx("SPDX-License-Identifier: AGPL-3.0-or-later")).toBe("AGPL-3.0");
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

  it("identifies a Creative Commons CC-BY-4.0 LICENSE file body", () => {
    const text =
      "Creative Commons Attribution 4.0 International License\n" +
      "By exercising the Licensed Rights, You accept and agree to the terms.\n" +
      "Section 1 – Definitions.\n" +
      "Section 2 – Scope.";
    expect(identifySpdx(text)).toBe("CC-BY-4.0");
  });
});

// ---------------------------------------------------------------------------
// classifyRisk
// ---------------------------------------------------------------------------

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

  it("classifies Creative Commons licenses", () => {
    expect(classifyRisk("CC-BY-4.0")).toBe("permissive");
    expect(classifyRisk("CC-BY-SA-4.0")).toBe("strong-copyleft");
    expect(classifyRisk("CC-BY-NC-4.0")).toBe("strong-copyleft");
  });

  it("returns unknown for unrecognized ids", () => {
    expect(classifyRisk("Made-Up-License")).toBe("unknown");
  });
});

// ---------------------------------------------------------------------------
// normalize
// ---------------------------------------------------------------------------

describe("normalize", () => {
  it("trims, lowercases, and strips surrounding quotes", () => {
    expect(normalize('  "MIT"  ')).toBe("mit");
    expect(normalize("'Apache-2.0'")).toBe("apache-2.0");
  });
});

// ---------------------------------------------------------------------------
// resolveLibraryLicense — resolution priority (framework-agnostic)
// ---------------------------------------------------------------------------

describe("resolveLibraryLicense — manifest reader priority", () => {
  it("prefers the manifest value over a LICENSE file", () => {
    const readFile: ReadFile = (p) => {
      if (p.endsWith("manifest")) return "MIT";
      if (p.endsWith("LICENSE")) return "BSD 3-Clause text...";
      return undefined;
    };
    const readdir: ReadDir = () => ["manifest", "LICENSE"];
    const out = resolveLibraryLicense(
      { name: "L", installDir: "/L" },
      readFile,
      readdir,
      { readManifestLicense: (dir, rf) => rf(`${dir}/manifest`), manifestSourceLabel: "manifest" },
    );
    expect(out.spdx).toBe("MIT");
    expect(out.source).toBe("manifest");
  });

  it("falls back to the LICENSE file when the manifest omits a license", () => {
    const readFile: ReadFile = (p) => {
      if (p.endsWith("manifest")) return "name=L\n";
      if (p.endsWith("LICENSE")) return "Apache License\nVersion 2.0";
      return undefined;
    };
    const readdir: ReadDir = () => ["manifest", "LICENSE"];
    const out = resolveLibraryLicense(
      { name: "L", installDir: "/L" },
      readFile,
      readdir,
      { readManifestLicense: (dir, rf) => rf(`${dir}/manifest`) },
    );
    expect(out.spdx).toBe("Apache-2.0");
    expect(out.source).toBe("license-file");
  });

  it("falls back to source-header comments when neither manifest nor LICENSE resolves", () => {
    const header =
      "/* Foo\n * Copyright (c) 2015\n *\n" +
      " * Permission is hereby granted, free of charge, to any person obtaining a copy\n */\n";
    const readFile: ReadFile = (p) => (p.endsWith("Foo.h") ? header : undefined);
    const readdir: ReadDir = (d) => (d === "/L" ? ["Foo.h"] : []);
    const out = resolveLibraryLicense({ name: "Foo", installDir: "/L" }, readFile, readdir);
    expect(out.spdx).toBe("MIT");
    expect(out.source).toBe("source-header");
  });

  it("marks unknown when nothing resolves", () => {
    const out = resolveLibraryLicense({ name: "L", installDir: "/L" }, () => undefined, () => []);
    expect(out.spdx).toBeUndefined();
    expect(out.risk).toBe("unknown");
    expect(out.source).toBe("none");
  });

  it("finds a LICENSE under a configured subdir (e.g. src/)", () => {
    // Separator-agnostic: root lists "src", the src dir lists LICENSE.
    const readFile: ReadFile = (p) =>
      p.endsWith("LICENSE") && p.includes("src") ? "Apache License\nVersion 2.0" : undefined;
    const readdir: ReadDir = (d) =>
      d.endsWith("L") && !d.includes("src") ? ["src"] : d.includes("src") ? ["LICENSE"] : [];
    const out = resolveLibraryLicense({ name: "L", installDir: "/L" }, readFile, readdir, {
      subdirs: ["src"],
    });
    expect(out.spdx).toBe("Apache-2.0");
    expect(out.source).toBe("license-file");
  });

  it("honors a custom manifest-source label (e.g. Arduino 'library.properties')", () => {
    // The manifest reader extracts just the license value (Arduino's
    // readPropertiesLicense returns the text after `license=`); here the file
    // carries the bare SPDX value to exercise that contract directly.
    const readFile: ReadFile = (p) =>
      p.endsWith("library.properties") ? "BSD-3-Clause" : undefined;
    const readdir: ReadDir = () => ["library.properties"];
    const out = resolveLibraryLicense(
      { name: "L", installDir: "/L" },
      readFile,
      readdir,
      {
        readManifestLicense: (dir, rf) => rf(`${dir}/library.properties`),
        manifestSourceLabel: "library.properties",
      },
    );
    expect(out.spdx).toBe("BSD-3-Clause");
    expect(out.source).toBe("library.properties");
  });
});

// ---------------------------------------------------------------------------
// readLicenseFile — British LICENCE spelling
// ---------------------------------------------------------------------------

describe("readLicenseFile — case-insensitive filename match", () => {
  it("finds LICENCE.txt (British spelling)", () => {
    const readFile: ReadFile = (p) =>
      p.endsWith("LICENCE.txt") ? "MIT licence\nPermission is hereby granted, free of charge" : undefined;
    const readdir: ReadDir = (d) => (d === "/lvgl" ? ["LICENCE.txt"] : []);
    const out = readLicenseFile("/lvgl", readFile, readdir);
    expect(out).toBeDefined();
    expect(identifySpdx(out!)).toBe("MIT");
  });

  it("finds a lowercase .rst LICENSE (e.g. trusted-firmware-m license.rst)", () => {
    const readFile: ReadFile = (p) =>
      p.endsWith("license.rst")
        ? "Redistribution and use in source and binary forms\nNeither the name of the copyright holder"
        : undefined;
    const readdir: ReadDir = (d) => (d === "/tfm" ? ["license.rst"] : []);
    const out = readLicenseFile("/tfm", readFile, readdir);
    expect(out).toBeDefined();
    expect(identifySpdx(out!)).toBe("BSD-3-Clause");
  });
});
