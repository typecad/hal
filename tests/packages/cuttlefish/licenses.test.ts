import { describe, it, expect } from "vitest";
import { identifySpdx, classifyRisk } from "../../../packages/cuttlefish/src/licenses";

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
